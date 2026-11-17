param([string]$Db, [string]$Schema)
# Read-only value-shape profile. Categorical columns: top values. Free/PII columns: shapes only (digits->9, letters->a).
$cs = "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$Db;Mode=Read;Persist Security Info=False;"
$cn = New-Object System.Data.OleDb.OleDbConnection($cs)
$cn.Open()
$d = Import-Csv $Schema
function Q($sql) {
  $cmd = $cn.CreateCommand(); $cmd.CommandText = $sql
  $da = New-Object System.Data.OleDb.OleDbDataAdapter($cmd); $dt = New-Object System.Data.DataTable
  [void]$da.Fill($dt); return ,$dt
}
function Br($n) { '[' + $n.Replace(']', ']]') + ']' }

"=== PER-TABLE COLUMNS WITH DATA (pos:name:type:filled) ==="
foreach ($g in ($d | Group-Object Table)) {
  if ($g.Name -like '~*') { continue }
  $withData = $g.Group | Where-Object { [int]$_.Filled -gt 0 -and $_.Column -notmatch '^Field(2[4-9]|[3-9]\d|1\d\d)$' } | Sort-Object { [int]$_.Pos }
  "## $($g.Name) rows=$($g.Group[0].Rows)"
  ($withData | ForEach-Object { "{0}:{1}:{2}:{3}" -f $_.Pos, $_.Column, $_.Type, $_.Filled }) -join ' | '
}

"=== FAILED TABLES: row count + first 30 column names ==="
foreach ($t in @('Dot Net  March 2024', 'DotNet 22 April')) {
  try {
    $n = (Q ("SELECT COUNT(*) FROM " + (Br $t))).Rows[0][0]
    $cols = $d | Where-Object { $_.Table -eq $t } | Sort-Object { [int]$_.Pos } | Select-Object -First 30
    "## $t rows=$n"
    foreach ($c in $cols) {
      try { $f = (Q ("SELECT COUNT(" + (Br $c.Column) + ") FROM " + (Br $t))).Rows[0][0] } catch { $f = 'err' }
      "{0}:{1}:{2}:{3}" -f $c.Pos, $c.Column, $c.Type, $f
    }
  } catch { "## $t ERROR $($_.Exception.Message)" }
}

"=== HEADERLESS TABLE CHECK (Dot Net): rows whose Field2 looks like a header ==="
try {
  $dt = Q "SELECT TOP 3 * FROM [Dot Net] WHERE [Field2] IN ('Name','NAME','name','Candidate Name')"
  foreach ($r in $dt.Rows) { ($dt.Columns | ForEach-Object { "{0}={1}" -f $_.ColumnName, $r[$_.ColumnName] }) -join ' | ' }
  "headerRows=$($dt.Rows.Count)"
} catch { "ERR $($_.Exception.Message)" }

$categorical = @('Heat', 'Notice Period', 'Final Status', 'Status', 'Source', 'HR Owner', 'Gender', 'Role')
$shape = @('Date', 'Phone', 'Experience ( & months)', 'Experience (Year & months)', 'in Last Company', 'year in Last Company', 'CTC', 'CTC (LPA)', 'ECTC', 'IQ Score/24', 'IQ Score', 'Tech Score /50', 'Email ID', 'Qualification')
$agg = @{}
foreach ($col in ($categorical + $shape)) { $agg[$col] = @{} }
foreach ($row in ($d | Where-Object { [int]$_.Filled -gt 0 -and ($categorical + $shape) -contains $_.Column -and $_.Table -notlike '~*' })) {
  try {
    $dt = Q ("SELECT " + (Br $row.Column) + " AS v, COUNT(*) AS n FROM " + (Br $row.Table) + " WHERE " + (Br $row.Column) + " IS NOT NULL GROUP BY " + (Br $row.Column))
    foreach ($r in $dt.Rows) {
      $v = [string]$r['v']
      if ($shape -contains $row.Column) {
        if ($r['v'] -is [datetime]) { $v = '<DateTime>' }
        elseif ($r['v'] -is [double] -or $r['v'] -is [int] -or $r['v'] -is [decimal] -or $r['v'] -is [long]) { $v = '<Number:' + (($v -replace '\d', '9') ) + '>' }
        else { $v = ($v -replace '\d', '9') -creplace '[A-Za-z]', 'a'; $v = $v -replace 'a{2,}', 'a+' -replace '9{5,}', '9{5+}' }
      } else { $v = $v.Trim().ToLower() }
      if ($v.Length -gt 60) { $v = $v.Substring(0, 60) + '...' }
      $agg[$row.Column][$v] = [int]$agg[$row.Column][$v] + [int]$r['n']
    }
  } catch { "ERR $($row.Table)/$($row.Column): $($_.Exception.Message)" }
}
foreach ($col in ($categorical + $shape)) {
  "=== $col : distinct=$($agg[$col].Count) ==="
  ($agg[$col].GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 30 | ForEach-Object { "{0} ({1})" -f $_.Key, $_.Value }) -join ' ; '
}

"=== Duplicate email check across tables (counts only) ==="
$emails = @{}; $total = 0
foreach ($row in ($d | Where-Object { [int]$_.Filled -gt 0 -and @('Email ID', 'E-mail ID', 'Email', 'Email Address') -contains $_.Column -and $_.Table -notlike '~*' })) {
  try {
    $dt = Q ("SELECT " + (Br $row.Column) + " AS v FROM " + (Br $row.Table) + " WHERE " + (Br $row.Column) + " IS NOT NULL")
    foreach ($r in $dt.Rows) { $e = ([string]$r['v']).Trim().ToLower(); if ($e -match '@') { $total++; $emails[$e] = [int]$emails[$e] + 1 } }
  } catch {}
}
"emailRows=$total distinctEmails=$($emails.Count) emailsAppearingMoreThanOnce=$(@($emails.GetEnumerator() | Where-Object { $_.Value -gt 1 }).Count)"
$cn.Close()

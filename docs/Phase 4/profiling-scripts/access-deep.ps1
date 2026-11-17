param([string]$Db, [string]$Schema)
# Second-pass, read-only profile of the Access file.
$cs = "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$Db;Mode=Read;Persist Security Info=False;"
$cn = New-Object System.Data.OleDb.OleDbConnection($cs)
$cn.Open()
$d = Import-Csv $Schema | Where-Object { $_.Table -notlike '~*' -and $_.Table -ne 'Table1' }
function Q($sql) {
  $cmd = $cn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
  $da = New-Object System.Data.OleDb.OleDbDataAdapter($cmd); $dt = New-Object System.Data.DataTable
  [void]$da.Fill($dt); return ,$dt
}
function Br($n) { '[' + $n.Replace(']', ']]') + ']' }
function Trunc($s, $n) { $s = ([string]$s) -replace '\s+', ' '; if ($s.Length -gt $n) { $s.Substring(0, $n) + '...' } else { $s } }

$tables = $d | Group-Object Table
$hyper = 'Hyper Automation Clean Sheet'
$emailCols = @('Email ID', 'E-mail ID', 'Email', 'Email Address'); $phoneCols = @('Phone', 'Contact Number')
$dateCols = @('Date'); $nameCols = @('Name')
$statusCols = @('Final Status', 'Status')
$noteCols = @('HR Quick comments', 'HR Quick Comments', 'Quickie Comments', 'Quicky Comments - HR Updates', 'HR owner feedback', 'HR Screening Comments', 'Action Taken / Comments - HR', 'Technical Skype/Telephonic', 'Technical 1st Round', 'Technical Skype/Telephonic/F2F - 1st Round', 'Technical F2F', 'Technical 2nd Round', 'Technical 2', 'Technical Skype/Telephonic/F2F - 2nd Round', 'Technical 3rd Round', 'Magerial Interview', 'Managerial Interview', 'CEO Interview', 'CEO Feedback', 'HR Interview', 'Key Skills')
function Pick($table, $cands, $hyperField) {
  if ($table -eq $hyper) { return $hyperField }
  $names = ($d | Where-Object { $_.Table -eq $table }).Column
  foreach ($c in $cands) { $m = $names | Where-Object { $_ -ieq $c } | Select-Object -First 1; if ($m) { return $m } }
  return $null
}

"=== A. OBJECTS: saved queries / primary keys ==="
try { ($cn.GetSchema('Views') | ForEach-Object { $_.TABLE_NAME }) -join ' ; ' } catch { "views: n/a" }
try { ($cn.GetSchema('Procedures') | ForEach-Object { $_.PROCEDURE_NAME }) -join ' ; ' } catch { "procs: n/a" }
try { ($cn.GetSchema('Indexes') | Where-Object { $_.PRIMARY_KEY -eq $true -and $_.TABLE_NAME -notlike 'MSys*' } | ForEach-Object { "$($_.TABLE_NAME).$($_.COLUMN_NAME)" }) -join ' ; ' } catch { "indexes: n/a" }

"=== B. 255-COLUMN TABLES: every column with data ==="
foreach ($t in @('Dot Net  March 2024', 'DotNet 22 April')) {
  $cols = @($d | Where-Object { $_.Table -eq $t } | Sort-Object { [int]$_.Pos })
  $out = @()
  for ($i = 0; $i -lt $cols.Count; $i += 40) {
    $chunk = $cols[$i..([Math]::Min($i + 39, $cols.Count - 1))]
    $k = 0; $parts = foreach ($c in $chunk) { "COUNT(" + (Br $c.Column) + ") AS c$k"; $k++ }
    $dt = Q ("SELECT " + ($parts -join ', ') + " FROM " + (Br $t))
    $k = 0; foreach ($c in $chunk) { $n = [int]$dt.Rows[0][$k]; if ($n -gt 0) { $out += ("{0}:{1}:{2}:{3}" -f $c.Pos, $c.Column, $c.Type, $n) }; $k++ }
  }
  "## $t"; $out -join ' | '
}

"=== C. STRAY / UNNAMED COLUMNS: distinct count and top values (truncated) ==="
foreach ($g in $tables) {
  $t = $g.Name
  $stray = $g.Group | Where-Object { ($_.Column -match '^Field\d+$' -and $t -ne $hyper) -or $_.Column.Trim() -eq '' -or $_.Column -match '^\s*\d+$' -or $_.Column -in @('Mail Sent Date', 'Job Profile') }
  if ($t -eq $hyper) { $stray = $g.Group | Where-Object { $_.Column -match '^Field(\d+)$' -and [int]$Matches[1] -ge 26 } }
  $shown = 0
  foreach ($c in ($stray | Sort-Object { [int]$_.Pos })) {
    if ($shown -ge 12) { "## $t : (more stray columns not shown)"; break }
    try {
      $dt = Q ("SELECT TOP 4 v, n FROM (SELECT " + (Br $c.Column) + " AS v, COUNT(*) AS n FROM " + (Br $t) + " WHERE " + (Br $c.Column) + " IS NOT NULL GROUP BY " + (Br $c.Column) + ") AS x ORDER BY n DESC")
      if ($dt.Rows.Count -eq 0) { continue }
      $shown++
      "## $t / pos $($c.Pos) [$($c.Column)] : " + (($dt.Rows | ForEach-Object { "'" + (Trunc $_.v 45) + "' x" + $_.n }) -join ' ; ')
    } catch { }
  }
}

"=== D. DATE YEAR HISTOGRAM PER TABLE ==="
foreach ($g in $tables) {
  $t = $g.Name; $col = Pick $t $dateCols 'Field1'; if (-not $col) { "## $t : no date column"; continue }
  $h = @{}
  try {
    $dt = Q ("SELECT " + (Br $col) + " AS v FROM " + (Br $t) + " WHERE " + (Br $col) + " IS NOT NULL")
    foreach ($r in $dt.Rows) {
      $v = $r.v; $y = 'unparsed'
      if ($v -is [datetime]) { $y = $v.Year }
      else {
        $s = ([string]$v).Trim().TrimEnd('`')
        if ($s -match '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$') { $y = [int]$Matches[3] }
        elseif ($s -match '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$') { $y = 2000 + [int]$Matches[3] }
        elseif ($s -match '^\d{5}(\.\d+)?$') { $y = [datetime]::FromOADate([double]$s).Year }
        elseif ($s -ieq 'Date') { $y = 'header' }
      }
      $h["$y"] = [int]$h["$y"] + 1
    }
    "## $t : " + (($h.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' ')
  } catch { "## $t : ERR $($_.Exception.Message)" }
}

"=== E. CONTACTABILITY + EMAIL OVERLAP ==="
$sets = @{}; $firstSeen = @{}
foreach ($g in $tables) {
  $t = $g.Name
  $n = Pick $t ($nameCols + @('Profile Name')) 'Field2'; $e = Pick $t $emailCols 'Field7'; $p = Pick $t $phoneCols 'Field6'
  if (-not $n) { "## $t : no name column"; continue }
  $sel = (Br $n) + " AS n, " + $(if ($e) { (Br $e) } else { 'NULL' }) + " AS e, " + $(if ($p) { (Br $p) } else { 'NULL' }) + " AS p"
  $dt = Q ("SELECT $sel FROM " + (Br $t))
  $rows = 0; $blank = 0; $both = 0; $eOnly = 0; $pOnly = 0; $none = 0; $multiE = 0; $set = New-Object 'System.Collections.Generic.HashSet[string]'; $dupIn = 0
  foreach ($r in $dt.Rows) {
    $nm = ([string]$r.n).Trim(); $em = ([string]$r.e).Trim().ToLower(); $ph = ([string]$r.p) -replace '\D', ''
    $hasE = $em -match '^[^@\s]+@[^@\s]+\.[a-z]{2,}'; $hasP = $ph.Length -ge 10
    if (-not $nm -and -not $hasE -and -not $hasP) { $blank++; continue }
    $rows++
    if ($hasE -and $hasP) { $both++ } elseif ($hasE) { $eOnly++ } elseif ($hasP) { $pOnly++ } else { $none++ }
    if ($hasE) {
      $list = $em -split '[,;/\s]+' | Where-Object { $_ -match '@' }
      if ($list.Count -gt 1) { $multiE++ }
      $first = $list | Select-Object -First 1
      if (-not $set.Add($first)) { $dupIn++ }
    }
  }
  $sets[$t] = $set
  "## $t : candidateRows=$rows blankRows=$blank email+phone=$both emailOnly=$eOnly phoneOnly=$pOnly neither=$none multiEmailCells=$multiE distinctEmails=$($set.Count) repeatWithinTable=$dupIn"
}
$all = New-Object 'System.Collections.Generic.HashSet[string]'; $tot = 0
foreach ($k in $sets.Keys) { $tot += $sets[$k].Count; foreach ($x in $sets[$k]) { [void]$all.Add($x) } }
"TOTAL per-table distinct emails summed=$tot ; distinct across file=$($all.Count)"
$names = @($sets.Keys | Sort-Object)
for ($i = 0; $i -lt $names.Count; $i++) { for ($j = $i + 1; $j -lt $names.Count; $j++) {
  $a = $sets[$names[$i]]; $b = $sets[$names[$j]]; $o = 0
  $small = $a; $big = $b; if ($a.Count -gt $b.Count) { $small = $b; $big = $a }
  foreach ($x in $small) { if ($big.Contains($x)) { $o++ } }
  if ($o -ge 5) { "overlap: [$($names[$i])] ($($a.Count)) x [$($names[$j])] ($($b.Count)) = $o" }
} }

"=== F. FINAL STATUS / STATUS: all distinct values ==="
$st = @{}
foreach ($g in $tables) {
  $t = $g.Name
  $cols = @(); if ($t -eq $hyper) { $cols = @('Field18') } else { $cols = @($g.Group | Where-Object { $statusCols -contains $_.Column -and [int]$_.Filled -gt 0 } | ForEach-Object { $_.Column }) }
  if ($t -in @('Dot Net  March 2024', 'DotNet 22 April')) { $cols = @('Status') }
  foreach ($c in $cols) {
    try { $dt = Q ("SELECT " + (Br $c) + " AS v, COUNT(*) AS n FROM " + (Br $t) + " WHERE " + (Br $c) + " IS NOT NULL GROUP BY " + (Br $c))
      foreach ($r in $dt.Rows) { $k = (Trunc ([string]$r.v).Trim().ToLower() 45); $st[$k] = [int]$st[$k] + [int]$r.n } } catch { }
  }
}
"distinct=$($st.Count)"
($st.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { "$($_.Key) ($($_.Value))" }) -join ' ; '

"=== G. MAX TEXT LENGTH PER NOTES COLUMN (across tables) ==="
$mx = @{}
foreach ($row in ($d | Where-Object { $noteCols -contains $_.Column -and [int]$_.Filled -gt 0 })) {
  try { $v = (Q ("SELECT MAX(LEN(" + (Br $row.Column) + ")) FROM " + (Br $row.Table))).Rows[0][0]; if ($v -isnot [DBNull] -and [int]$v -gt [int]$mx[$row.Column]) { $mx[$row.Column] = [int]$v } } catch { }
}
($mx.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ; '
"declared types of notes columns: " + ((($d | Where-Object { $noteCols -contains $_.Column -and [int]$_.Filled -gt 0 }) | Group-Object Type | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ' ; ')

"=== H. HYPER AUTOMATION: types by position + non-header fill ==="
($d | Where-Object { $_.Table -eq $hyper -and [int]$_.Pos -le 27 } | Sort-Object { [int]$_.Pos } | ForEach-Object { "{0}:{1}:{2}:{3}" -f $_.Pos, $_.Column, $_.Type, $_.Filled }) -join ' | '
$cn.Close()

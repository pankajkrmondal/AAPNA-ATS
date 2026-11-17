# Stage 1, step 2 of docs/Phase 4/PLAN-MS-Access-Data-Migration-Mapping.md (3.12).
# Reads every candidate table of the Access file, READ-ONLY, and writes one
# JSON-lines file per table with the values untouched. No database is involved.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File 1-extract-access.ps1 -AccessFile <file.accdb> -Out <work folder>
#
# Run with Windows PowerShell 5.1 (the ACE OLEDB provider must match its bitness).
# The output holds candidate personal data: -Out must be OUTSIDE the repository.
#
# Line format: {"t":"<table>","id":"<row id>","v":{"<column>":["s|n|d|b","<value>"], ...}}
#   s = text (as stored, not trimmed)   n = number (plain digits, no exponent)
#   d = date (yyyy-MM-ddTHH:mm:ss)      b = boolean
# Empty (NULL) cells are left out. Nothing else is dropped or changed.
# Row id: the Access ID column. A table without one is read in a single query and
# its rows are numbered r1, r2, ... in the order Access returns them.
param(
  [Parameter(Mandatory = $true)][string]$AccessFile,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Q([string]$x) { [System.Web.HttpUtility]::JavaScriptStringEncode($x, $true) }

$rawDir = Join-Path $Out 'raw'
New-Item -ItemType Directory -Force $rawDir | Out-Null

# Tables the plan ignores (3.1): Access leftovers (~TMP*) and the empty Table1.
$ignore = @('Table1')
$chunkSize = 40

$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$AccessFile;Mode=Read;")
$conn.Open()
$manifest = @()
try {
  $allColumns = @($conn.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Columns, $null) | ForEach-Object { $_ })
  $tables = @($conn.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables, $null) |
    Where-Object { $_.TABLE_TYPE -eq 'TABLE' } |
    ForEach-Object { $_.TABLE_NAME } |
    Where-Object { $_ -notlike '~*' -and $_ -notlike 'MSys*' -and $ignore -notcontains $_ } |
    Sort-Object)

  $n = 0
  foreach ($t in $tables) {
    $n++
    $cols = @($allColumns | Where-Object { $_.TABLE_NAME -eq $t } | Sort-Object ORDINAL_POSITION | ForEach-Object { [string]$_.COLUMN_NAME })
    $hasId = ($cols -contains 'ID')
    $dataCols = @($cols | Where-Object { $_ -ne 'ID' })

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT COUNT(*) FROM [$t]"
    $expected = [int]$cmd.ExecuteScalar()

    # Column groups: 40 at a time when there is an ID to join on (two tables report
    # 255 columns and a single SELECT of all of them fails); otherwise one group.
    # A table with no ID has nothing to join the groups on. Its rows are matched by
    # position, and every group re-reads the first six columns as an anchor: if the
    # anchor of row N differs between two groups, the order moved and the run stops.
    $groups = @()
    for ($i = 0; $i -lt $dataCols.Count; $i += $chunkSize) {
      $groups += , @($dataCols[$i..([Math]::Min($i + $chunkSize, $dataCols.Count) - 1)])
    }
    if ($groups.Count -eq 0) { $groups += , @() }
    $anchorCols = @()
    if (-not $hasId -and $groups.Count -gt 1) { $anchorCols = @($dataCols | Select-Object -First 6) }
    $anchors = @{}

    $rows = @{}
    $order = New-Object System.Collections.Generic.List[string]
    $dupIds = 0
    $g = 0
    foreach ($chunk in $groups) {
      $g++
      $lead = @('[ID]')
      if (-not $hasId) { $lead = @($anchorCols | ForEach-Object { '[' + $_ + '] AS [__a' + [array]::IndexOf($anchorCols, $_) + ']' }) }
      $skip = $lead.Count
      $sel = (@($lead) + @($chunk | ForEach-Object { '[' + $_ + ']' })) -join ','
      $sql = "SELECT $sel FROM [$t]"
      if ($hasId) { $sql += ' ORDER BY [ID]' }
      $cmd.CommandText = $sql
      $r = $cmd.ExecuteReader()
      $seq = 0
      try {
        while ($r.Read()) {
          $seq++
          if ($hasId) { $id = [Convert]::ToString($r.GetValue(0), $inv) } else {
            $id = "r$seq"
            if ($skip -gt 0) {
              $fp = ''
              for ($a = 0; $a -lt $skip; $a++) { $fp += [Convert]::ToString($r.GetValue($a), $inv) + [char]31 }
              if ($g -eq 1) { $anchors[$id] = $fp }
              elseif ($anchors[$id] -ne $fp) { throw "Table [$t]: row order changed between column groups at row $seq." }
            }
          }
          if (-not $rows.ContainsKey($id)) {
            if ($g -gt 1) { throw "Table [$t]: row id $id appeared in a later column group only." }
            $rows[$id] = New-Object System.Text.StringBuilder
            $order.Add($id)
          } elseif ($g -eq 1) { $dupIds++ }
          $sb = $rows[$id]
          for ($c = $skip; $c -lt $r.FieldCount; $c++) {
            if ($r.IsDBNull($c)) { continue }
            $v = $r.GetValue($c)
            if ($v -is [string]) { $k = 's'; $val = $v }
            elseif ($v -is [datetime]) { $k = 'd'; $val = $v.ToString('yyyy-MM-ddTHH:mm:ss', $inv) }
            elseif ($v -is [bool]) { $k = 'b'; $val = $v.ToString().ToLower() }
            elseif ($v -is [double] -or $v -is [single]) {
              $d = [double]$v
              $k = 'n'
              if ($d -eq [Math]::Floor($d) -and [Math]::Abs($d) -lt 1e15) { $val = $d.ToString('0', $inv) }
              else { $val = ([decimal]$d).ToString($inv) }
            }
            else { $k = 'n'; $val = [Convert]::ToString($v, $inv) }
            if ($sb.Length -gt 0) { [void]$sb.Append(',') }
            [void]$sb.Append((Q $chunk[$c - $skip])).Append(':["').Append($k).Append('",').Append((Q $val)).Append(']')
          }
        }
      } finally { $r.Close() }
    }
    if ($dupIds -gt 0) { throw "Table [$t]: $dupIds repeated ID value(s); rows cannot be told apart." }

    $file = Join-Path $rawDir ('{0:d2}.jsonl' -f $n)
    $w = New-Object System.IO.StreamWriter($file, $false, $utf8)
    try {
      foreach ($id in $order) {
        $w.WriteLine('{"t":' + (Q $t) + ',"id":' + (Q $id) + ',"v":{' + $rows[$id].ToString() + '}}')
      }
    } finally { $w.Close() }

    $ok = ($order.Count -eq $expected)
    $manifest += [ordered]@{ n = $n; table = $t; file = (Split-Path $file -Leaf); hasId = $hasId; columns = $cols; accessCount = $expected; extracted = $order.Count; countsMatch = $ok }
    $mark = 'OK'
    if (-not $ok) { $mark = 'MISMATCH' }
    $idNote = ''
    if (-not $hasId) { $idNote = '  (no ID column)' }
    '{0,2}. {1,-34} columns {2,3}  Access rows {3,5}  extracted {4,5}  {5}{6}' -f $n, $t, $cols.Count, $expected, $order.Count, $mark, $idNote
  }
} finally { $conn.Close() }

$meta = [ordered]@{ sourceFile = (Split-Path $AccessFile -Leaf); extractedAt = (Get-Date).ToString('s'); tables = $manifest }
[System.IO.File]::WriteAllText((Join-Path $Out 'manifest.json'), ($meta | ConvertTo-Json -Depth 6), $utf8)
$bad = @($manifest | Where-Object { -not $_.countsMatch })
$total = ($manifest | ForEach-Object { $_.extracted } | Measure-Object -Sum).Sum
"Tables: $($manifest.Count)   rows: $total   mismatches: $($bad.Count)"
if ($bad.Count -gt 0) { exit 1 }

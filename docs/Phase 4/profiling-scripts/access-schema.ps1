param([string]$Db, [string]$Out)
# Read-only schema profile of the Access file: tables, columns, types, row counts, fill counts.
# Emits no cell values.
$cs = "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$Db;Mode=Read;Persist Security Info=False;"
$cn = New-Object System.Data.OleDb.OleDbConnection($cs)
$cn.Open()
$typeMap = @{ 2='SmallInt'; 3='Integer'; 4='Single'; 5='Double'; 6='Currency'; 7='DateTime'; 11='Boolean'; 17='Byte'; 72='GUID'; 128='Binary'; 130='Text'; 131='Decimal'; 203='Memo'; 204='Binary'; 205='OLE' }
$tables = $cn.GetSchema('Tables') | Where-Object { $_.TABLE_TYPE -eq 'TABLE' } | Sort-Object TABLE_NAME
$cols = $cn.GetSchema('Columns')
$rows = @()
foreach ($t in $tables) {
  $tn = $t.TABLE_NAME
  $tc = $cols | Where-Object { $_.TABLE_NAME -eq $tn } | Sort-Object ORDINAL_POSITION
  $cmd = $cn.CreateCommand()
  $parts = @('COUNT(*) AS [__n]')
  $i = 0
  foreach ($c in $tc) { $parts += ("COUNT([{0}]) AS [c{1}]" -f $c.COLUMN_NAME.Replace(']', ']]'), $i); $i++ }
  $cmd.CommandText = "SELECT " + ($parts -join ', ') + " FROM [" + $tn.Replace(']', ']]') + "]"
  $n = -1; $fills = @()
  try {
    $r = $cmd.ExecuteReader()
    if ($r.Read()) { $n = $r.GetValue(0); for ($k = 1; $k -lt $r.FieldCount; $k++) { $fills += $r.GetValue($k) } }
    $r.Close()
  } catch { $fills = @() }
  $i = 0
  foreach ($c in $tc) {
    $dt = [int]$c.DATA_TYPE
    $tname = $typeMap[$dt]; if (-not $tname) { $tname = "type$dt" }
    $f = ''
    if ($fills.Count -gt $i) { $f = $fills[$i] }
    $rows += [pscustomobject]@{ Table = $tn; Rows = $n; Pos = $c.ORDINAL_POSITION; Column = $c.COLUMN_NAME; Type = $tname; MaxLen = $c.CHARACTER_MAXIMUM_LENGTH; Filled = $f }
    $i++
  }
}
$cn.Close()
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 $Out
"tables=$($tables.Count) columns=$($rows.Count)"

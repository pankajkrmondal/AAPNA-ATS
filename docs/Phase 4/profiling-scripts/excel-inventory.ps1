param([string]$Root)
# Read-only inventory: every spreadsheet under the root, its sheets, header row and row count. No cell values beyond headers.
$files = Get-ChildItem $Root -Recurse -File | Where-Object { $_.Extension -match '^\.(xlsx|xls|xlsm|csv)$' }
"spreadsheets=$($files.Count)"
"--- file-type counts per top folder ---"
Get-ChildItem $Root -Directory | ForEach-Object {
  $top = $_.Name
  $g = Get-ChildItem $_.FullName -Recurse -File | Group-Object { $_.Extension.ToLower() } | Sort-Object Count -Descending | ForEach-Object { "$($_.Name)=$($_.Count)" }
  "$top : " + ($g -join ' ')
}
foreach ($f in $files) {
  $rel = $f.FullName.Substring($Root.Length + 1)
  "## $rel ($([Math]::Round($f.Length / 1KB)) KB)"
  if ($f.Extension -eq '.csv') { "  header: " + (Get-Content $f.FullName -TotalCount 1); continue }
  $cs = "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$($f.FullName);Mode=Read;Extended Properties=""Excel 12.0 Xml;HDR=YES;IMEX=1"";"
  if ($f.Extension -eq '.xls') { $cs = "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$($f.FullName);Mode=Read;Extended Properties=""Excel 8.0;HDR=YES;IMEX=1"";" }
  try {
    $cn = New-Object System.Data.OleDb.OleDbConnection($cs); $cn.Open()
    $sheets = $cn.GetSchema('Tables') | Where-Object { $_.TABLE_NAME -match '\$''?$' } | ForEach-Object { $_.TABLE_NAME }
    foreach ($s in $sheets) {
      try {
        $cmd = $cn.CreateCommand(); $cmd.CommandText = "SELECT TOP 1 * FROM [$s]"
        $r = $cmd.ExecuteReader(); $h = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $n = $r.GetName($i); if ($n -notmatch '^F\d+$') { $h += $n } }
        $extra = $r.FieldCount - $h.Count; $r.Close()
        $cmd.CommandText = "SELECT COUNT(*) FROM [$s]"; $n = $cmd.ExecuteScalar()
        "  sheet [$s] rows=$n unnamedCols=$extra headers: " + ($h -join ' | ')
      } catch { "  sheet [$s] ERR $($_.Exception.Message)" }
    }
    $cn.Close()
  } catch { "  ERR $($_.Exception.Message)" }
}

param([string]$Root, [string]$Units)
# Second, independent count of every loaded sheet (plan 6.2, check 2: "counted by two separate tools").
# Called by 1-extract-excel.mjs.
#
# The plan named ACE OLEDB for this count, but the ACE provider is not registered on the
# migration machine (checked 19 Nov 2026, 32- and 64-bit). This script therefore reads the
# .xlsx package itself with .NET (System.IO.Compression + XML), opened READ-ONLY, and counts
# the rows of the sheet that hold at least one non-blank cell value (shared strings resolved,
# error cells not counted). It shares no code with SheetJS, which makes the first count.
# Prints one JSON line per sheet. No cell values are printed.
#
# -Units is a JSON file: [{ "file": "<path relative to Root>", "sheet": "<sheet name>" }, ...]
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$list = Get-Content -Raw -Encoding UTF8 $Units | ConvertFrom-Json

function Read-Xml($zip, [string]$name) {
  $e = $zip.GetEntry($name)
  if (-not $e) { return $null }
  $r = New-Object System.IO.StreamReader($e.Open())
  try { $x = New-Object System.Xml.XmlDocument; $x.LoadXml($r.ReadToEnd()); return $x } finally { $r.Close() }
}
function Get-Text($node) { (($node.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText }) -join '') }

foreach ($u in $list) {
  $path = Join-Path $Root $u.file
  $n = $null; $err = $null; $zip = $null
  try {
    if ($path -notmatch '\.(xlsx|xlsm)$') { throw 'Only .xlsx/.xlsm packages can be recounted by this reader.' }
    $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
    $wb = Read-Xml $zip 'xl/workbook.xml'
    $rels = Read-Xml $zip 'xl/_rels/workbook.xml.rels'
    $sheet = $wb.SelectNodes("//*[local-name()='sheet']") | Where-Object { $_.GetAttribute('name') -eq $u.sheet } | Select-Object -First 1
    if (-not $sheet) { throw "Sheet not found in workbook.xml" }
    $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = ($rels.SelectNodes("//*[local-name()='Relationship']") | Where-Object { $_.GetAttribute('Id') -eq $rid } | Select-Object -First 1).GetAttribute('Target')
    $part = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target }
    $shared = @()
    $sst = Read-Xml $zip 'xl/sharedStrings.xml'
    if ($sst) { $shared = @($sst.SelectNodes("//*[local-name()='si']") | ForEach-Object { Get-Text $_ }) }
    $ws = Read-Xml $zip $part
    $n = 0
    foreach ($row in $ws.SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']")) {
      foreach ($c in $row.SelectNodes("*[local-name()='c']")) {
        $t = $c.GetAttribute('t')
        if ($t -eq 'e') { continue }
        $v = $c.SelectSingleNode("*[local-name()='v']")
        $val = if ($t -eq 's') { if ($v) { $shared[[int]$v.InnerText] } else { '' } }
               elseif ($t -eq 'inlineStr') { $is = $c.SelectSingleNode("*[local-name()='is']"); if ($is) { Get-Text $is } else { '' } }
               elseif ($v) { $v.InnerText } else { '' }
        if (([string]$val).Trim() -ne '') { $n++; break }
      }
    }
  } catch { $err = $_.Exception.Message; $n = $null } finally { if ($zip) { $zip.Dispose() } }
  [pscustomobject]@{ file = $u.file; sheet = $u.sheet; nonBlankRows = $n; error = $err } | ConvertTo-Json -Compress
}

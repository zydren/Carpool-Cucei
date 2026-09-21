 _lines = [IO.File]::ReadAllLines("src\\services\\tripService.ts", [Text.Encoding]::UTF8)
Write-Output ("TOTAL_LINES=" + $_lines.Length)
foreach ($i in 1..100) { if ($i -le $_lines.Length) { Write-Output ($i.ToString() + ":" + $_lines[$i-1]) } }
Write-Output "--- 180-195 ---"
foreach ($i in 180..196) { if ($i -le $_lines.Length) { Write-Output ($i.ToString() + ":" + $_lines[$i-1]) } }
exit
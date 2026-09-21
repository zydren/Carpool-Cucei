 $needle = [IO.File]::ReadAllText('src\services\tripService.ts').IndexOf('distanceToOriginKm: number | null;')
Write-Output ('MARKER idx=' + $needle)
$head = [IO.File]::ReadAllText('src\services\tripService.ts').Substring(0,$needle)
Write-Output ('HEAD_CHARS=' + $head.Length)
$tailStart = $needle + 'distanceToOriginKm: number | null;'.Length
Write-Output ('TAIL_START=' + $tailStart)
exit

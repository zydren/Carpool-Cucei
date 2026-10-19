$ErrorActionPreference = 'Continue'
Push-Location $PSScriptRoot

# Type-check AISLADO de api/ (fuera de tsc -b, que solo cubre src/).
$tscApiOut = & npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2023 --lib es2023,dom --types node --allowImportingTsExtensions --skipLibCheck api/route.ts src/services/tomTomRouteProxyRequest.ts 2>&1
$tscApiCode = $LASTEXITCODE

# Build real del proyecto (cubre src/, incluido el nuevo módulo de lógica pura).
$tscBuildOut = & npx tsc -b --force 2>&1
$tscBuildCode = $LASTEXITCODE

Pop-Location

$txt = "TSC_API_EXIT=$tscApiCode`nTSC_BUILD_EXIT=$tscBuildCode`n"
$txt += "===== TSC api/ OUTPUT =====`n$tscApiOut`n"
$txt += "===== TSC build OUTPUT =====`n$tscBuildOut`n"
$txt | Out-File (Join-Path $PSScriptRoot 'verify_api_result.txt') -Encoding utf8
'DONE' | Out-File (Join-Path $PSScriptRoot 'verify_api_done.marker') -Encoding utf8

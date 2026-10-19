$ErrorActionPreference = 'Continue'
Push-Location $PSScriptRoot

# 1) Pruebas del adaptador (runner built-in, sin dependencias).
$testOut = & node --test "test/**/*.test.ts" 2>&1
$testCode = $LASTEXITCODE

# 2) Verificación de tipos del build real del proyecto.
$tscOut = & npx tsc -b --force 2>&1
$tscCode = $LASTEXITCODE

# 3) Lint de los archivos tocados.
$lintOut = & npx eslint src/services/tomTomAdapter.ts test/tomTomAdapter.test.ts test/tomTomAdapter.fixture.ts 2>&1
$lintCode = $LASTEXITCODE

Pop-Location

$txt = "TEST_EXIT=$testCode`nTSC_EXIT=$tscCode`nESLINT_EXIT=$lintCode`n"
$txt += "===== TEST OUTPUT =====`n$testOut`n"
$txt += "===== TSC OUTPUT =====`n$tscOut`n"
$txt += "===== ESLINT OUTPUT =====`n$lintOut`n"
$txt | Out-File (Join-Path $PSScriptRoot 'test_result.txt') -Encoding utf8
# Marca de finalización para saber que el script terminó.
'DONE' | Out-File (Join-Path $PSScriptRoot 'test_done.marker') -Encoding utf8

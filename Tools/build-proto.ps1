# 编译《A+》命令行原型。
#
# 刻意**不需要 .NET SDK**：直接用 .NET Framework 自带的 csc.exe 编译，
# 这样一台只装了 Unity 的机器也能跑原型（本仓库的 CI 与验收都是这条路）。
#
#   powershell -ExecutionPolicy Bypass -File Tools\build-proto.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot                 # .../A+
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc (need .NET Framework 4.x)" }

$outDir = Join-Path $PSScriptRoot "APlusProto\bin"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir "APlusProto.exe"

# 运行时代码：与 Unity 编译的是同一批源文件（见 5.5.5）。
$src = @()
$src += (Get-ChildItem (Join-Path $root "Assets\Scripts\APlus") -Filter *.cs -Recurse | ForEach-Object { $_.FullName })
$src += (Join-Path $PSScriptRoot "APlusProto\Program.cs")

& $csc /nologo /target:exe /codepage:65001 /optimize+ "/out:$exe" /r:System.dll /r:System.Core.dll $src
if ($LASTEXITCODE -ne 0) { throw "compile failed (exit $LASTEXITCODE)" }
Write-Host "built $exe"

$ErrorActionPreference = "Stop"
$installer = Get-ChildItem build/windows/*-win-x64.exe | Select-Object -First 1
if (!$installer) { throw "Installer not found" }
$testRoot = Join-Path $env:RUNNER_TEMP "Mamba 中文验收"
New-Item -ItemType Directory -Force $testRoot | Out-Null
$installDir = Join-Path $testRoot "安装目录"
$install = Start-Process -FilePath $installer.FullName -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
$exe = Join-Path $installDir "Black Mamba Workbench.exe"
if (!(Test-Path $exe)) { throw "Installed executable missing" }
$env:MAMBA_DESKTOP_TEST_DIR = Join-Path $testRoot "验收数据"
New-Item -ItemType Directory -Force $env:MAMBA_DESKTOP_TEST_DIR | Out-Null
$env:MAMBA_SMOKE_VIDEO = Join-Path $testRoot "虚构 视频.mp4"
ffmpeg -v error -f lavfi -i "color=c=blue:s=160x90:d=1" -c:v libx264 -pix_fmt yuv420p -y $env:MAMBA_SMOKE_VIDEO
if ($LASTEXITCODE -ne 0) { throw "Fixture encoding failed" }
foreach ($phase in @("write", "read")) {
  $process = Start-Process -FilePath $exe -ArgumentList "--smoke-$phase" -PassThru
  if (!$process.WaitForExit(90000)) { $process.Kill(); throw "Desktop smoke timed out" }
  $result = Join-Path $env:MAMBA_DESKTOP_TEST_DIR "$phase.json"
  if (!(Test-Path $result)) {
    Get-Content (Join-Path $env:MAMBA_DESKTOP_TEST_DIR "error.txt") -ErrorAction SilentlyContinue
    throw "Desktop smoke did not complete"
  }
  $report = Get-Content $result -Raw | ConvertFrom-Json
  if (!$report.passed) { throw "Desktop smoke failed" }
  Get-Content $result
}
Copy-Item (Join-Path $env:MAMBA_DESKTOP_TEST_DIR "*.json") build/windows/

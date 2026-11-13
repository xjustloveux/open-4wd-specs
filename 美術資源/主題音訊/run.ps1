# 重新產生主題音訊（會覆寫本資料夾內既有的 .ogg、loop-check 與 manifest.json）。
# 用法：.\run.ps1                     四個主題依序產生（一次一個程序），最後合併 manifest.json
#       .\run.ps1 -Only default        只重新產生單一主題，再合併 manifest.json
param(
  [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe',
  [string]$Only
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Blender)) { throw "找不到 Blender：$Blender（用 -Blender 指定路徑）" }
$common = @('--background', '--factory-startup', '--python-exit-code', '1', '--python')
$themes = if ($Only) { @($Only) } else {
  @('default', 'christmas-workshop-2026-75fe9c', 'halloween-workshop-2026-a9028c', 'moon-rabbit-workshop-2026-97c954')
}
$failed = @()
foreach ($theme in $themes) {
  & $Blender @common (Join-Path $PSScriptRoot 'generate.py') -- --only $theme
  if ($LASTEXITCODE -ne 0) { $failed += $theme }
}
& $Blender @common (Join-Path $PSScriptRoot 'generate.py') -- --merge
if ($failed.Count -gt 0) { Write-Error "驗證未通過的主題：$($failed -join ', ')"; exit 1 }
exit $LASTEXITCODE

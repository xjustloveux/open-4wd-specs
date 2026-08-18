[CmdletBinding()]
param(
    [string]$BundleDirectory,
    [switch]$Publish,
    [string]$ConfirmImmutablePublish
)

$ErrorActionPreference = 'Stop'
# 先擋掉缺確認值的發布請求:後續的 bundle 驗證與下載回讀都要處理數 GB,
# 沒有理由讓一個必然失敗的參數組合先花掉那些時間。
if ($Publish -and [string]::IsNullOrWhiteSpace($ConfirmImmutablePublish)) {
    throw 'immutable publication requires -ConfirmImmutablePublish <exact-tag>'
}
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($BundleDirectory)) { $BundleDirectory = Join-Path $repositoryRoot 'release-output' }
$bundle = (Resolve-Path -LiteralPath $BundleDirectory).Path

function Invoke-Checked {
    param([Parameter(Mandatory)][string]$Program, [Parameter(Mandatory)][string[]]$Arguments)
    $result = & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
    return $result
}

# 上傳／下載動輒數 GB。Invoke-Checked 會吃掉輸出，執行者看不出是在傳輸還是卡住，
# 因此傳輸類指令改用不捕獲輸出的版本，讓 gh 自己的進度直接寫到主控台。
function Invoke-Streamed {
    param([Parameter(Mandatory)][string]$Program, [Parameter(Mandatory)][string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
}

function Write-Phase {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host ('[{0}] {1}' -f (Get-Date).ToString('HH:mm:ss'), $Message)
}

function Get-GitHubRepository {
    param([Parameter(Mandatory)][string]$Remote)
    if ($Remote -match 'github\.com[/:](?<repo>[^/]+/[^/]+?)(?:\.git)?$') { return $Matches.repo }
    throw "origin is not a GitHub repository: $Remote"
}

Push-Location -LiteralPath $repositoryRoot
try {
    $manifest = (Invoke-Checked node @((Join-Path $PSScriptRoot 'verify-authoring-release.mjs'), '--output', $bundle)) | ConvertFrom-Json
    $status = Invoke-Checked git @('status', '--porcelain', '--untracked-files=all')
    if ($status) { throw 'working tree must be clean before creating the exact Release tag' }
    $head = (Invoke-Checked git @('rev-parse', 'HEAD')).Trim()
    if ($head -cne $manifest.sourceCommit) { throw "HEAD $head differs from manifest sourceCommit $($manifest.sourceCommit)" }
    $repository = Get-GitHubRepository ((Invoke-Checked git @('remote', 'get-url', 'origin')).Trim())

    Invoke-Checked gh @('auth', 'status') | Out-Host
    $authenticatedRepository = (Invoke-Checked gh @('repo', 'view', $repository, '--json', 'nameWithOwner', '--jq', '.nameWithOwner')).Trim()
    if ($authenticatedRepository -cne $repository) { throw "authenticated repository differs: $authenticatedRepository" }

    $tag = [string]$manifest.tag
    $releaseJson = & gh release view $tag --repo $repository --json 'isDraft,tagName,targetCommitish,assets' 2>$null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked gh @('release', 'create', $tag, '--repo', $repository, '--target', $manifest.sourceCommit, '--draft', '--latest=false', '--title', "Authoring source $tag", '--notes', "source-commit: $($manifest.sourceCommit)") | Out-Host
        $releaseJson = Invoke-Checked gh @('release', 'view', $tag, '--repo', $repository, '--json', 'isDraft,tagName,targetCommitish,assets')
    }
    $release = $releaseJson | ConvertFrom-Json
    if ($release.tagName -cne $tag -or -not $release.isDraft) { throw 'existing Release must be the exact Draft tag' }
    if ($release.targetCommitish -and $release.targetCommitish -cne $manifest.sourceCommit) { throw "Release target $($release.targetCommitish) differs from manifest sourceCommit" }

    # 以顯式管線取名稱：對空集合做成員列舉（$release.assets.name）會回傳 $null，
    # 經 @() 包裝後變成「含一個 $null 的一元素陣列」，使剛建立、尚無 asset 的 Draft
    # 誤觸下方的 unexpected asset 檢查而永遠走不到上傳迴圈。
    $expectedNames = @('authoring-release-manifest.json', 'SHA256SUMS') + @($manifest.releaseAssets | ForEach-Object { $_.name })
    $existingNames = @($release.assets | ForEach-Object { $_.name })
    foreach ($name in $existingNames) {
        if ($expectedNames -cnotcontains $name) { throw "Draft contains unexpected asset: $name" }
    }
    $pendingNames = @($expectedNames | Where-Object { $existingNames -cnotcontains $_ })
    if ($pendingNames.Count -eq 0) { Write-Phase "Draft 已含全部 $($expectedNames.Count) 個 asset,略過上傳。" }
    else {
        $pendingBytes = ($pendingNames | ForEach-Object { (Get-Item -LiteralPath (Join-Path $bundle $_)).Length } | Measure-Object -Sum).Sum
        Write-Phase ('上傳 {0} 個 asset,共 {1:N2} GB。' -f $pendingNames.Count, ($pendingBytes / 1GB))
        $uploaded = 0
        foreach ($name in $pendingNames) {
            $uploaded++
            $size = (Get-Item -LiteralPath (Join-Path $bundle $name)).Length
            Write-Phase ('  [{0}/{1}] 上傳 {2}（{3:N1} MB）' -f $uploaded, $pendingNames.Count, $name, ($size / 1MB))
            Invoke-Streamed gh @('release', 'upload', $tag, (Join-Path $bundle $name), '--repo', $repository)
        }
    }

    # 每一趟都必須做全新回讀,舊副本不得充當本次證據;但它同時是數 GB 的可重建衍生物,
    # 保留只會累積磁碟並讓人反覆手動搬移,因此直接清除並明示。
    $readback = Join-Path $bundle '.readback'
    if (Test-Path -LiteralPath $readback) {
        Write-Phase "清除上一輪回讀副本:$readback"
        Remove-Item -LiteralPath $readback -Recurse -Force
    }
    New-Item -ItemType Directory -Path $readback | Out-Null
    Write-Phase ('下載回讀 {0} 個 asset 以逐檔比對…' -f $expectedNames.Count)
    Invoke-Streamed gh @('release', 'download', $tag, '--repo', $repository, '--dir', $readback)
    $compared = 0
    foreach ($name in $expectedNames) {
        $compared++
        $localPath = Join-Path $bundle $name
        $remotePath = Join-Path $readback $name
        if (-not (Test-Path -LiteralPath $remotePath -PathType Leaf)) { throw "download readback is missing: $name" }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $localPath).Hash -cne (Get-FileHash -Algorithm SHA256 -LiteralPath $remotePath).Hash) { throw "download readback differs: $name" }
        Write-Phase ('  [{0}/{1}] 比對通過 {2}' -f $compared, $expectedNames.Count, $name)
    }

    $receipt = [ordered]@{ schemaVersion = 1; repository = $repository; tag = $tag; sourceCommit = $manifest.sourceCommit; draftReadbackVerifiedAt = [DateTimeOffset]::UtcNow.ToString('o'); published = $false }
    if ($Publish) {
        if ($ConfirmImmutablePublish -cne $tag) { throw "immutable publication requires -ConfirmImmutablePublish '$tag'" }
        Write-Phase "發布為 immutable Release（不可逆）:$tag"
        Invoke-Checked gh @('release', 'edit', $tag, '--repo', $repository, '--draft=false', '--latest=false') | Out-Host
        $receipt.published = $true
        $receipt.publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'publish-receipt.json') -Encoding utf8NoBOM
    if (-not $Publish) { Write-Host "Draft $tag uploaded and download-readback verified. Review it, then rerun with -Publish -ConfirmImmutablePublish '$tag'." }
}
finally { Pop-Location }

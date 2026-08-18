[CmdletBinding()]
param(
    [string]$BundleDirectory,
    [switch]$Publish,
    [string]$ConfirmImmutablePublish
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($BundleDirectory)) { $BundleDirectory = Join-Path $repositoryRoot 'release-output' }
$bundle = (Resolve-Path -LiteralPath $BundleDirectory).Path

function Invoke-Checked {
    param([Parameter(Mandatory)][string]$Program, [Parameter(Mandatory)][string[]]$Arguments)
    $result = & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
    return $result
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

    $expectedNames = @('authoring-release-manifest.json', 'SHA256SUMS') + @($manifest.releaseAssets.name)
    $existingNames = @($release.assets.name)
    foreach ($name in $existingNames) {
        if ($expectedNames -cnotcontains $name) { throw "Draft contains unexpected asset: $name" }
    }
    foreach ($name in $expectedNames) {
        if ($existingNames -cnotcontains $name) { Invoke-Checked gh @('release', 'upload', $tag, (Join-Path $bundle $name), '--repo', $repository) | Out-Host }
    }

    $readback = Join-Path $bundle '.readback'
    if (Test-Path -LiteralPath $readback) { throw "readback directory already exists; inspect or move it before retrying: $readback" }
    New-Item -ItemType Directory -Path $readback | Out-Null
    Invoke-Checked gh @('release', 'download', $tag, '--repo', $repository, '--dir', $readback) | Out-Host
    foreach ($name in $expectedNames) {
        $localPath = Join-Path $bundle $name
        $remotePath = Join-Path $readback $name
        if (-not (Test-Path -LiteralPath $remotePath -PathType Leaf)) { throw "download readback is missing: $name" }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $localPath).Hash -cne (Get-FileHash -Algorithm SHA256 -LiteralPath $remotePath).Hash) { throw "download readback differs: $name" }
    }

    $receipt = [ordered]@{ schemaVersion = 1; repository = $repository; tag = $tag; sourceCommit = $manifest.sourceCommit; draftReadbackVerifiedAt = [DateTimeOffset]::UtcNow.ToString('o'); published = $false }
    if ($Publish) {
        if ($ConfirmImmutablePublish -cne $tag) { throw "immutable publication requires -ConfirmImmutablePublish '$tag'" }
        Invoke-Checked gh @('release', 'edit', $tag, '--repo', $repository, '--draft=false', '--latest=false') | Out-Host
        $receipt.published = $true
        $receipt.publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'publish-receipt.json') -Encoding utf8NoBOM
    if (-not $Publish) { Write-Host "Draft $tag uploaded and download-readback verified. Review it, then rerun with -Publish -ConfirmImmutablePublish '$tag'." }
}
finally { Pop-Location }

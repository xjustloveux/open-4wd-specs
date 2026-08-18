[CmdletBinding()]
param(
    [string]$InputDirectory,
    [string]$OutputDirectory,
    [string]$SourceSha
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$arguments = @((Join-Path $PSScriptRoot 'prepare-authoring-release.mjs'))
if (-not [string]::IsNullOrWhiteSpace($InputDirectory)) { $arguments += @('--input', $InputDirectory) }
if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) { $arguments += @('--output', $OutputDirectory) }
if (-not [string]::IsNullOrWhiteSpace($SourceSha)) { $arguments += @('--source-sha', $SourceSha) }
Push-Location -LiteralPath $repositoryRoot
try {
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "authoring release preparation exited with code $LASTEXITCODE" }
}
finally { Pop-Location }

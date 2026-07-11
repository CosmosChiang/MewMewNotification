[CmdletBinding()]
param([string]$OutputPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$arguments = @('tools/package-extension.js')
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $arguments += "--output=$OutputPath"
}
& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Cross-platform package tool failed with exit code $LASTEXITCODE."
}

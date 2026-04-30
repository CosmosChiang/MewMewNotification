[CmdletBinding()]
param(
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'manifest.json'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Could not find manifest.json at '$manifestPath'."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if (-not $manifest.version) {
    throw 'manifest.json is missing the version field.'
}

$distPath = Join-Path $repoRoot 'dist'
$stagePath = Join-Path $distPath 'package'
$defaultOutputPath = Join-Path $distPath 'mewmew-notification-extension.zip'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $zipPath = $defaultOutputPath
} elseif ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $zipPath = $OutputPath
} else {
    $zipPath = Join-Path $repoRoot $OutputPath
}

$zipPath = [System.IO.Path]::GetFullPath($zipPath)
$zipDirectory = Split-Path -Parent $zipPath

$filesToCopy = @(
    'manifest.json',
    'background.js',
    'options.html',
    'popup.html',
    'LICENSE',
    'scripts\options.js',
    'scripts\popup.js',
    'scripts\shared\config-manager.js',
    'scripts\shared\i18n.js'
)

$directoriesToCopy = @(
    'icons',
    'styles',
    '_locales'
)

New-Item -ItemType Directory -Path $distPath -Force | Out-Null
New-Item -ItemType Directory -Path $zipDirectory -Force | Out-Null

if (Test-Path -LiteralPath $stagePath) {
    Remove-Item -LiteralPath $stagePath -Recurse -Force
}

try {
    New-Item -ItemType Directory -Path $stagePath -Force | Out-Null

    foreach ($relativePath in $filesToCopy) {
        $sourcePath = Join-Path $repoRoot $relativePath

        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Required file not found: '$relativePath'."
        }

        $destinationPath = Join-Path $stagePath $relativePath
        $destinationDirectory = Split-Path -Parent $destinationPath

        if ($destinationDirectory) {
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        }

        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }

    foreach ($relativePath in $directoriesToCopy) {
        $sourcePath = Join-Path $repoRoot $relativePath

        if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
            throw "Required directory not found: '$relativePath'."
        }

        $destinationPath = Join-Path $stagePath $relativePath
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
    }

    if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stagePath,
        $zipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    Write-Host "Created Chrome Web Store package: $zipPath"
    Write-Host "Manifest version: $($manifest.version)"
} finally {
    if (Test-Path -LiteralPath $stagePath) {
        Remove-Item -LiteralPath $stagePath -Recurse -Force
    }
}

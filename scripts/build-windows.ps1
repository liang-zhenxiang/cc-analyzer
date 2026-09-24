#Requires -Version 5.1
param(
    [ValidateSet("x86_64", "aarch64")]
    [string]$Architecture = "x86_64"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$AppName = "CC Analyzer"
$BinaryName = "cc-analyzer.exe"
$RustTarget = "$Architecture-pc-windows-msvc"
$DistDir = Join-Path $RootDir "dist-windows"
$PackageDir = Join-Path $DistDir $AppName
$ZipPath = Join-Path $DistDir "CC_Analyzer_$($Architecture -replace '^x86_64$', 'x64').zip"

Push-Location $RootDir
try {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $NpmCommand) {
        Write-Error "npm is required to build the web UI"
        exit 1
    }

    npm --prefix web ci
    if ($LASTEXITCODE -ne 0) { exit 1 }

    npm --prefix web run build
    if ($LASTEXITCODE -ne 0) { exit 1 }

    if (Get-Command rustup -ErrorAction SilentlyContinue) {
        rustup target add $RustTarget
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    cargo build --release --manifest-path src-tauri/Cargo.toml --target $RustTarget
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    if (Test-Path $PackageDir) {
        Remove-Item $PackageDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

    Copy-Item "src-tauri/target/$RustTarget/release/$BinaryName" `
        (Join-Path $PackageDir "$AppName.exe")
    Copy-Item (Join-Path $RootDir "LICENSE") $PackageDir
    Copy-Item (Join-Path $RootDir "NOTICE") $PackageDir

    if (Test-Path $ZipPath) {
        Remove-Item $ZipPath -Force
    }
    Compress-Archive -Path $PackageDir -DestinationPath $ZipPath -Force

    Write-Output "Created $PackageDir"
    Write-Output "Created $ZipPath"
}
finally {
    Pop-Location
}

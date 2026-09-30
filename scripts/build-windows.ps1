#Requires -Version 5.1
<#
    构建 Windows 产物：NSIS 安装程序 + 便携版（绿色）ZIP。

    走 Tauri 官方打包流程——identifier、copyright、publisher 这些 bundle
    配置集中在 src-tauri/tauri.conf.json，与 macOS / Linux 共用同一份。

    用法：
      powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
      powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -Architecture aarch64
#>
param(
    [ValidateSet("x86_64", "aarch64")]
    [string]$Architecture = "x86_64"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$AppName = "CC Analyzer"
$RustTarget = "$Architecture-pc-windows-msvc"
$ReleaseDir = Join-Path $RootDir "src-tauri/target/$RustTarget/release"
$BundleDir = Join-Path $ReleaseDir "bundle"
$DistDir = Join-Path $RootDir "dist-windows"
$ZipSuffix = $Architecture -replace '^x86_64$', 'x64'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "需要 npm"
    exit 1
}

Push-Location $RootDir
try {
    # 根 package.json 提供 tauri CLI（版本由 package-lock.json 锁定，
    # 不依赖全局安装，也不用在 lockfile 之外临时拉取）
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    rustup target add $RustTarget
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # 前端依赖：tauri 的 beforeBuildCommand 只执行 npm run build，依赖要先装好。
    # 用 ci 而不是 install，保证与 lockfile 逐字一致。
    npm --prefix web ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # tauri build：beforeBuildCommand 构建 web/dist → cargo build → 打包 NSIS 安装程序
    npx tauri build --target $RustTarget
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    if (Test-Path $DistDir) { Remove-Item $DistDir -Recurse -Force }
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

    # ① NSIS 安装程序（双击安装，带开始菜单项与卸载入口）
    $Installer = Get-ChildItem (Join-Path $BundleDir "nsis") -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $Installer) {
        Write-Error "没有找到 NSIS 安装程序，检查 tauri.conf.json 的 bundle.targets 是否含 nsis"
        exit 1
    }
    Copy-Item $Installer.FullName $DistDir

    # ② 便携版 ZIP：复用刚构建出的 exe，不重复编译一次
    #    存在的意义是给「不想安装、放到 U 盘就能用」的场景
    $PortableDir = Join-Path $DistDir $AppName
    New-Item -ItemType Directory -Path $PortableDir -Force | Out-Null
    Copy-Item (Join-Path $ReleaseDir "cc-analyzer.exe") (Join-Path $PortableDir "$AppName.exe")
    Copy-Item (Join-Path $RootDir "LICENSE") $PortableDir
    Copy-Item (Join-Path $RootDir "NOTICE") $PortableDir
    Compress-Archive -Path $PortableDir `
        -DestinationPath (Join-Path $DistDir "CC_Analyzer_${ZipSuffix}_portable.zip") -Force
    Remove-Item $PortableDir -Recurse -Force

    Write-Output "产物："
    Get-ChildItem $DistDir -File | ForEach-Object { Write-Output "  $($_.Name)" }
}
finally {
    Pop-Location
}
param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distRoot = Join-Path $projectRoot 'dist'
$manifestPath = Join-Path $distRoot 'manifest.json'
$packagePath = Join-Path $projectRoot 'package.json'
$productionEnvPath = Join-Path $projectRoot '.env.local'
$productionWorkerPath = Join-Path $projectRoot 'backend/wrangler.toml'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw 'Production dist/manifest.json is missing. Run npm run build first.'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw 'The production manifest is not Manifest V3.' }
if ($manifest.version -ne $package.version) { throw 'package.json and manifest versions do not match.' }
$expectedOptionalHost = 'https://cfgh-auth.kartikeyaaryam7.workers.dev/*'
if (@($manifest.optional_host_permissions).Count -ne 1 -or $manifest.optional_host_permissions[0] -cne $expectedOptionalHost) {
  throw 'Production optional host permission must be limited to the configured production Worker hostname.'
}

if (-not (Test-Path -LiteralPath $productionEnvPath -PathType Leaf)) { throw 'Ignored .env.local is required to package the configured production build.' }
$productionVars = @{}
foreach ($line in (Get-Content -LiteralPath $productionEnvPath)) {
  if ($line -match '^\s*([^#\s][^=]*)=(.*)$') {
    $key = $Matches[1].Trim()
    if ($key -match '(?i)(secret|token|password)') { throw "Unexpected credential-like key in .env.local: $key" }
    $productionVars[$key] = $Matches[2].Trim().Trim('"').Trim("'")
  }
}
if (-not $productionVars['VITE_GITHUB_APP_CLIENT_ID'] -or $productionVars['VITE_GITHUB_APP_CLIENT_ID'] -match '^REPLACE_') { throw 'Production GitHub App Client ID is missing from .env.local.' }
if ($productionVars['VITE_GITHUB_APP_SLUG'] -cne 'codeforces-github-sync') { throw 'Production GitHub App slug does not match.' }
if ($productionVars['VITE_AUTH_API_BASE_URL'] -cne 'https://cfgh-auth.kartikeyaaryam7.workers.dev') { throw 'Production Worker URL does not match.' }

$productionWorker = Get-Content -LiteralPath $productionWorkerPath -Raw
$workerClient = [regex]::Match($productionWorker, '(?m)^GITHUB_APP_CLIENT_ID\s*=\s*"([^"]+)"')
if (-not $workerClient.Success -or $workerClient.Groups[1].Value -cne $productionVars['VITE_GITHUB_APP_CLIENT_ID']) { throw 'Production Worker and extension Client IDs do not match.' }
if ($productionWorker -notmatch '(?m)^EXTENSION_ORIGIN\s*=\s*"chrome-extension://ahcgidlkjifgfdcalleiijiabidfehjd"') { throw 'Production Worker extension origin does not match the pinned ID.' }
if ($productionWorker -notmatch '(?m)^GITHUB_REDIRECT_URI\s*=\s*"https://ahcgidlkjifgfdcalleiijiabidfehjd\.chromiumapp\.org/github"') { throw 'Production Worker redirect URI does not match the pinned ID.' }

$requiredFiles = @('manifest.json', 'index.html', 'dashboard.html', 'privacy.html', $manifest.background.service_worker, $manifest.action.default_popup)
foreach ($icon in $manifest.icons.PSObject.Properties) { $requiredFiles += [string]$icon.Value }
foreach ($icon in $manifest.action.default_icon.PSObject.Properties) { $requiredFiles += [string]$icon.Value }
foreach ($required in ($requiredFiles | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath (Join-Path $distRoot $required) -PathType Leaf)) {
    throw "Manifest/runtime file is missing from dist/: $required"
  }
}

$textFiles = Get-ChildItem -LiteralPath $distRoot -Recurse -File | Where-Object { $_.Extension -in @('.html', '.js', '.json', '.css') }
$bundleText = ($textFiles | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
foreach ($requiredValue in @($productionVars['VITE_GITHUB_APP_CLIENT_ID'], $productionVars['VITE_GITHUB_APP_SLUG'], $productionVars['VITE_AUTH_API_BASE_URL'])) {
  if (-not $bundleText.Contains($requiredValue)) { throw 'Production OAuth configuration is not embedded in the current dist/ build.' }
}
$testConfigPath = Join-Path $projectRoot 'backend/wrangler.test.toml'
$testConfig = Get-Content -LiteralPath $testConfigPath -Raw
$testClientMatch = [regex]::Match($testConfig, '(?m)^GITHUB_APP_CLIENT_ID\s*=\s*"([^"]+)"')
$testOriginMatch = [regex]::Match($testConfig, '(?m)^EXTENSION_ORIGIN\s*=\s*"([^"]+)"')
$testRedirectMatch = [regex]::Match($testConfig, '(?m)^GITHUB_REDIRECT_URI\s*=\s*"([^"]+)"')
$forbidden = @(
  'cfgh-auth-local-test',
  '127.0.0.1',
  'localhost',
  'GITHUB_APP_CLIENT_SECRET',
  'REPLACE_WITH_PRODUCTION_GITHUB_APP_CLIENT_ID',
  'REPLACE_WITH_PUBLISHED_EXTENSION_ID',
  'REPLACE_WITH_EXTENSION_ID',
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----'
)
foreach ($match in @($testClientMatch, $testOriginMatch, $testRedirectMatch)) {
  if ($match.Success -and $match.Groups[1].Value -notmatch '^REPLACE_') { $forbidden += $match.Groups[1].Value }
}
foreach ($file in $textFiles) {
  $content = [IO.File]::ReadAllText($file.FullName)
  foreach ($marker in $forbidden) {
    if ($content.Contains($marker)) { throw "Production build contains a forbidden test/local/credential marker ($marker)." }
  }
  if ([regex]::IsMatch($content, '(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:EC |OPENSSH )?PRIVATE KEY-----)')) {
    throw 'Production build contains a token-like credential or private-key block.'
  }
}

if (-not $OutputPath) {
  $OutputPath = Join-Path $projectRoot "release\v$($manifest.version)\Codeforces-GitHub-Sync-v$($manifest.version)-public-candidate.zip"
} elseif (-not [IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $projectRoot $OutputPath
}
$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw "Refusing to overwrite existing archive: $OutputPath" }

$files = Get-ChildItem -LiteralPath $distRoot -Recurse -File | Where-Object {
  $_.FullName -notmatch '[\\/]store-assets[\\/]' -and $_.Extension -ne '.map'
} | Sort-Object { [IO.Path]::GetRelativePath($distRoot, $_.FullName).Replace('\', '/') }

Add-Type -AssemblyName System.IO.Compression
$outputStream = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$archive = [IO.Compression.ZipArchive]::new($outputStream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($file in $files) {
    $entryName = [IO.Path]::GetRelativePath($distRoot, $file.FullName).Replace('\', '/')
    $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
    $inputStream = [IO.File]::OpenRead($file.FullName)
    try {
      $entryStream = $entry.Open()
      try { $inputStream.CopyTo($entryStream) } finally { $entryStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }
} finally {
  $archive.Dispose()
}

$check = [IO.Compression.ZipFile]::OpenRead($OutputPath)
try {
  $names = @($check.Entries | ForEach-Object { $_.FullName })
  if ($names -notcontains 'manifest.json') { throw 'Archive manifest.json is not at the ZIP root.' }
  foreach ($required in $requiredFiles) {
    if ($names -notcontains $required.Replace('\', '/')) { throw "Archive is missing required runtime file: $required" }
  }
  if ($names -match '(^|/)(\.env[^/]*|\.dev\.vars[^/]*|dist-test|node_modules)(/|$)' -or $names -match '\.map$|\.pem$|\.key$|\.p12$|\.pfx$|\.crx$') {
    throw 'Archive contains a development, secret, signing, or source-map file.'
  }
  if ($names -match '^store-assets/') { throw 'Archive should not include non-runtime store assets.' }
  $unexpected = @($names | Where-Object {
    $_ -notmatch '^(manifest\.json|index\.html|dashboard\.html|privacy\.html|background\.js|assets/[A-Za-z0-9._-]+\.(js|css)|icons/icon(16|32|48|128)\.png)$'
  })
  if ($unexpected.Count -gt 0) { throw 'Archive contains files outside the approved runtime allowlist.' }
} finally {
  $check.Dispose()
}

$hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash
Write-Output "Created clean production archive: $OutputPath"
Write-Output "Entry count: $($names.Count)"
Write-Output "SHA-256: $hash"

param(
  [string]$OutputDirectory = 'outputs/store-submissions-v0.2.0-edge-keyfix',
  [switch]$Force = $false
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not [IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot $OutputDirectory
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$builds = @(
  @{ Name = 'Edge'; Directory = 'dist-edge'; Archive = "Codeforces-GitHub-Sync-Edge-v$version.zip" },
  @{ Name = 'Firefox'; Directory = 'dist-firefox'; Archive = "Codeforces-GitHub-Sync-Firefox-v$version.zip" }
)
$results = [Collections.Generic.List[object]]::new()

function Get-PngSize([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 24 -or [Text.Encoding]::ASCII.GetString($bytes, 1, 3) -ne 'PNG') {
    throw "Expected a PNG image: $Path"
  }
  $width = ([int]$bytes[16] * 16777216) + ([int]$bytes[17] * 65536) + ([int]$bytes[18] * 256) + [int]$bytes[19]
  $height = ([int]$bytes[20] * 16777216) + ([int]$bytes[21] * 65536) + ([int]$bytes[22] * 256) + [int]$bytes[23]
  return @($width, $height)
}

function Get-RelativePath([string]$BaseDirectory, [string]$Path) {
  $base = [IO.Path]::GetFullPath($BaseDirectory).TrimEnd('\', '/') + '\'
  $full = [IO.Path]::GetFullPath($Path)
  if ($full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($base.Length).Replace('\', '/')
  }
  $baseUri = [Uri]$base
  $targetUri = [Uri]$full
  return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('\', '/')
}

function Add-DeterministicZip([string]$Root, [string[]]$Files, [string]$Destination) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($file in ($Files | Sort-Object)) {
      $relative = Get-RelativePath $Root $file
      $entry = $archive.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
      $input = [IO.File]::OpenRead($file)
      try {
        $entryStream = $entry.Open()
        try { $input.CopyTo($entryStream) } finally { $entryStream.Dispose() }
      } finally { $input.Dispose() }
    }
  } finally { $archive.Dispose() }
}

function Assert-Archive([string]$Path, [string[]]$ExpectedNames, [bool]$RequireManifest = $true) {
  $archive = [IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $names = @($archive.Entries | ForEach-Object { $_.FullName })
    if ($RequireManifest -and $names -notcontains 'manifest.json') { throw "manifest.json is not at archive root: $Path" }
    foreach ($name in $ExpectedNames) {
      if ($names -notcontains $name.Replace('\', '/')) { throw "Archive is missing required file '$name': $Path" }
    }
    if ($names -match '(^|/)\.env(?!\.example$|\.test\.example$)[^/]*|(^|/)(\.dev\.vars[^/]*|\.wrangler|node_modules|dist|dist-test|dist-edge|dist-firefox|release|outputs|work)(/|$)' -or
        $names -match '\.(map|pem|key|p12|pfx|crx)$|(^|/)wrangler\.[^/]*\.local\.toml$') {
      throw "Archive contains local, generated, secret, or signing material: $Path"
    }
    return $names
  } finally { $archive.Dispose() }
}

$edgeIcon = Join-Path $projectRoot 'public/icons/icon128.png'
$tile = Join-Path $projectRoot 'public/store-assets/promo-small-440x280.png'
if ((Get-PngSize $edgeIcon) -join 'x' -ne '128x128') { throw 'The Edge store logo must be a 128x128 PNG or larger.' }
if ((Get-PngSize $tile) -join 'x' -ne '440x280') { throw 'The Edge promotional tile must be exactly 440x280.' }

foreach ($build in $builds) {
  $root = Join-Path $projectRoot $build.Directory
  $manifestPath = Join-Path $root 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Missing $($build.Directory)/manifest.json. Run the corresponding build first." }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.manifest_version -ne 3 -or $manifest.version -ne $version) { throw "$($build.Name) manifest version or format is invalid." }
  if ($build.Name -eq 'Firefox') {
    if ($manifest.browser_specific_settings.gecko.id -cne 'codeforces-github-sync@forrealtho' -or $manifest.key) { throw 'Firefox identity/manifest configuration is invalid.' }
  } elseif ($manifest.key) {
    throw 'Edge Add-ons rejects manifest.key; build a store package without it.'
  }
  $files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object {
    $_.FullName -notmatch '[\\/]store-assets[\\/]' -and $_.Extension -ne '.map'
  } | ForEach-Object { $_.FullName })
  $bundle = ($files | Where-Object { $_ -match '\.(js|html|json|css)$' } | ForEach-Object { [IO.File]::ReadAllText($_) }) -join "`n"
  if ($bundle -match '(?i)(127\.0\.0\.1|localhost|\.dev\.vars|cfgh-auth-local-test|github_pat_[a-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)') {
    throw "$($build.Name) build contains a test/local endpoint or credential marker."
  }
  $archivePath = Join-Path $OutputDirectory $build.Archive
  $results.Add([pscustomobject]@{ Root = $root; Files = $files; Manifest = $manifest; Archive = $archivePath; Name = $build.Name })
}

$sourcePaths = @('README.md', 'CHANGELOG.md', '.gitignore', '.env.example', '.env.test.example', 'package.json', 'package-lock.json', 'index.html', 'dashboard.html', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'docs', 'src', 'public', 'backend', 'scripts')
$sourceFiles = [Collections.Generic.List[string]]::new()
foreach ($path in $sourcePaths) {
  $absolute = Join-Path $projectRoot $path
  if (-not (Test-Path -LiteralPath $absolute)) { continue }
  if ((Get-Item -LiteralPath $absolute).PSIsContainer) {
    foreach ($file in Get-ChildItem -LiteralPath $absolute -Recurse -File) { $sourceFiles.Add($file.FullName) }
  } else { $sourceFiles.Add((Resolve-Path -LiteralPath $absolute).Path) }
}
$sourceFiles = @($sourceFiles | Sort-Object -Unique | Where-Object {
  $relative = Get-RelativePath $projectRoot $_
  $relative -notmatch '(^|/)(node_modules|\.git|\.wrangler|dist|dist-test|dist-edge|dist-firefox|release|outputs|work)(/|$)' -and
  $relative -notmatch '(^|/)(\.env(?!\.example$|\.test\.example$)[^/]*|\.dev\.vars[^/]*|wrangler\.[^/]*\.local\.toml)$' -and
  $relative -notmatch '\.(map|pem|key|p12|pfx|crx|sqlite|db)$'
})
if ($sourceFiles.Count -eq 0 -or $sourceFiles -notcontains (Join-Path $projectRoot 'package-lock.json')) { throw 'The Firefox source archive is missing source or its lockfile.' }
$sourceArchive = Join-Path $OutputDirectory "Codeforces-GitHub-Sync-Firefox-Source-v$version.zip"

$allArchives = @($results | ForEach-Object { $_.Archive }) + $sourceArchive
foreach ($path in $allArchives) {
  if (Test-Path -LiteralPath $path) {
    if ($Force) {
      Remove-Item -LiteralPath $path -Force
    } else {
      throw "Refusing to overwrite existing store submission file: $path. Pass -Force to overwrite."
    }
  }
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

foreach ($result in $results) {
  $runtimeNames = @($result.Files | ForEach-Object { Get-RelativePath $result.Root $_ })
  Add-DeterministicZip -Root $result.Root -Files $result.Files -Destination $result.Archive
  $null = Assert-Archive -Path $result.Archive -ExpectedNames $runtimeNames
}
Add-DeterministicZip -Root $projectRoot -Files $sourceFiles -Destination $sourceArchive
$null = Assert-Archive -Path $sourceArchive -ExpectedNames @('README.md', 'package.json', 'package-lock.json', 'src/background/index.ts', 'scripts/build-firefox.mjs', 'docs/CROSS_BROWSER_RELEASE.md') -RequireManifest $false

$assetDirectory = Join-Path $OutputDirectory 'listing-assets'
$edgeAssets = Join-Path $assetDirectory 'edge'
$firefoxAssets = Join-Path $assetDirectory 'firefox'
New-Item -ItemType Directory -Path $edgeAssets -Force | Out-Null
New-Item -ItemType Directory -Path $firefoxAssets -Force | Out-Null
Copy-Item -LiteralPath $edgeIcon -Destination (Join-Path $edgeAssets 'logo-128.png')
Copy-Item -LiteralPath $tile -Destination (Join-Path $edgeAssets 'promo-small-440x280.png')
foreach ($image in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'docs/images') -Filter '*.png' -File) {
  Copy-Item -LiteralPath $image.FullName -Destination (Join-Path $firefoxAssets $image.Name)
}

foreach ($path in $allArchives) {
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  Write-Output "$([IO.Path]::GetFileName($path))  $hash"
}
Write-Output "Store listing assets: $assetDirectory"

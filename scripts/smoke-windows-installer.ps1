# Run only in an expendable Windows user profile, such as a hosted CI runner.
$ErrorActionPreference = 'Stop'
$version = (Get-Content "$PSScriptRoot/../package.json" -Raw | ConvertFrom-Json).version
$installer = (Resolve-Path "$PSScriptRoot/../release/$version/*-setup-x64.exe").Path
$testRoot = Join-Path $env:TEMP ('wsm installer smoke ' + [guid]::NewGuid())
$installDir = Join-Path $testRoot 'installed app'
$binDir = Join-Path $installDir 'bin'
$cmdDir = Join-Path $binDir 'cmd'
$originalPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$processPath = $env:Path

function Assert-True($condition, [string]$message) {
  if (-not $condition) { throw $message }
}
function Run-Installer([string]$file, [string]$arguments) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
  if (-not $process.WaitForExit(180000)) {
    $process.Kill()
    throw "Installer timed out: $file"
  }
  Assert-True ($process.ExitCode -eq 0) "Installer failed with exit $($process.ExitCode)"
}
function User-Path-Entries {
  @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ })
}
function Get-CommandPath([string]$name) {
  $cmd = Get-Command $name | Select-Object -First 1
  $path = $cmd.Path
  if (-not $path) { $path = $cmd.Source }
  if (-not $path) { throw "$name has no Path/Source (type $($cmd.CommandType))" }
  return [System.IO.Path]::GetFullPath($path)
}
function Assert-InstalledCommand([string]$name, [string]$expected) {
  Assert-True (Test-Path -LiteralPath $expected) "Installer did not write $expected; bin=$((Get-ChildItem -LiteralPath $binDir -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', '); cmd=$((Get-ChildItem -LiteralPath $cmdDir -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', '); resources=$((Get-ChildItem -LiteralPath (Join-Path $installDir 'resources') -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')"
  $actual = Get-CommandPath $name
  $expectedFull = [System.IO.Path]::GetFullPath($expected)
  Assert-True ($actual -ieq $expectedFull) "Wrong PATH resolution for $name : got '$actual' expected '$expectedFull'"
}

New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  Run-Installer $installer "/S /currentuser /D=$installDir"
  Assert-True (Test-Path "$installDir/WorkspaceManager.exe") 'Desktop executable was not installed'
  Assert-True ((User-Path-Entries)[0] -eq $binDir) 'Installer did not prepend CLI script dir to user PATH'
  Assert-True ((User-Path-Entries)[1] -eq $cmdDir) 'Installer did not add CLI cmd dir after the script dir'
  Assert-True ((Get-ItemProperty 'HKCU:/Software/Workspace Manager').CliBin -eq $binDir) 'Installer did not record CLI bin'
  Assert-True ((Get-ItemProperty 'HKCU:/Software/Workspace Manager').CliCmd -eq $cmdDir) 'Installer did not record CLI cmd dir'
  $env:Path = ($binDir + ';' + $cmdDir + ';' + $processPath)
  $emptyStore = Join-Path $testRoot 'empty store.json'
  '{"version":14,"groups":[],"workspaces":[],"terminals":[],"settings":{}}' | Set-Content $emptyStore -Encoding utf8NoBOM
  $wrappers = @(
    @{ Name = 'wsm.cmd'; Path = (Join-Path $cmdDir 'wsm.cmd') },
    @{ Name = 'workspace-manager.cmd'; Path = (Join-Path $cmdDir 'workspace-manager.cmd') },
    @{ Name = 'wsm.ps1'; Path = (Join-Path $binDir 'wsm.ps1') },
    @{ Name = 'workspace-manager.ps1'; Path = (Join-Path $binDir 'workspace-manager.ps1') }
  )
  foreach ($wrapper in $wrappers) {
    Assert-InstalledCommand $wrapper.Name $wrapper.Path
    & $wrapper.Path --help
    Assert-True ($LASTEXITCODE -eq 0) "Installed $($wrapper.Name) failed to execute the CLI"
    $output = & $wrapper.Path list --store $emptyStore --json
    Assert-True ($LASTEXITCODE -eq 0) "Installed $($wrapper.Name) failed with a store path containing spaces"
    Assert-True ((($output | Out-String).Trim()) -eq '[]') "Unexpected empty catalog output from $($wrapper.Name)"
    # Windows PowerShell 5 with $ErrorActionPreference Stop is how start-dev.ps1 runs wsm.
    $cli = $wrapper.Path.Replace("'", "''")
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "`$ErrorActionPreference='Stop'; & '$cli' --help; exit `$LASTEXITCODE"
    Assert-True ($LASTEXITCODE -eq 0) "Windows PowerShell 5 failed to run $($wrapper.Name) --help"
  }

  $resolved = Get-Command wsm | Select-Object -First 1
  Assert-True ($resolved.CommandType -eq 'ExternalScript') "wsm resolved to $($resolved.CommandType) $($resolved.Path) $($resolved.Source) instead of wsm.ps1"
  Assert-True ((Get-CommandPath 'wsm') -ieq [System.IO.Path]::GetFullPath((Join-Path $binDir 'wsm.ps1'))) "Get-Command wsm did not prefer the PowerShell wrapper"
  $binDirLiteral = $binDir.Replace("'", "''")
  $cmdDirLiteral = $cmdDir.Replace("'", "''")
  $ps5Probe = @"
`$ErrorActionPreference = 'Stop'
`$env:Path = '$binDirLiteral;$cmdDirLiteral;' + `$env:Path
`$resolved = Get-Command wsm | Select-Object -First 1
if (`$resolved.CommandType -ne 'ExternalScript') {
  throw ('PS5 wsm resolved to ' + `$resolved.CommandType + ' ' + `$resolved.Path + ' ' + `$resolved.Source)
}
wsm --help
exit `$LASTEXITCODE
"@
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $ps5Probe
  Assert-True ($LASTEXITCODE -eq 0) 'Windows PowerShell 5 failed to run bare wsm --help the way start-dev.ps1 does'

  & node "$PSScriptRoot/smoke-packaged-app.mjs" "$installDir/WorkspaceManager.exe"
  Assert-True ($LASTEXITCODE -eq 0) 'Installed desktop/PTY smoke test failed'

  # Reinstalling the same version exercises upgrade hooks and PATH de-duplication.
  Run-Installer $installer "/S /currentuser /D=$installDir"
  Assert-True (@((User-Path-Entries) | Where-Object { $_ -eq $binDir }).Count -eq 1) 'Upgrade duplicated CLI PATH entry'
  Assert-True (@((User-Path-Entries) | Where-Object { $_ -eq $cmdDir }).Count -eq 1) 'Upgrade duplicated CLI cmd PATH entry'
  $uninstaller = (Get-ChildItem $installDir -Filter 'Uninstall*.exe' | Select-Object -First 1).FullName
  Assert-True ([bool]$uninstaller) 'Uninstaller was not installed'
  Run-Installer $uninstaller "/S /currentuser _?=$installDir"
  Assert-True (-not ((User-Path-Entries) -contains $binDir)) 'Uninstall left CLI bin on user PATH'
  Assert-True (-not ((User-Path-Entries) -contains $cmdDir)) 'Uninstall left CLI cmd dir on user PATH'
  Assert-True (-not (Test-Path "$binDir/wsm.cmd")) 'Uninstall left wsm.cmd behind'
  Assert-True (-not (Test-Path "$binDir/workspace-manager.cmd")) 'Uninstall left workspace-manager.cmd behind'
  Assert-True (-not (Test-Path "$binDir/wsm.ps1")) 'Uninstall left wsm.ps1 behind'
  Assert-True (-not (Test-Path "$binDir/workspace-manager.ps1")) 'Uninstall left workspace-manager.ps1 behind'
  Assert-True (-not (Test-Path "$cmdDir/wsm.cmd")) 'Uninstall left cmd\wsm.cmd behind'
  Assert-True (-not (Get-ItemProperty 'HKCU:/Software/Workspace Manager' -Name CliBin -ErrorAction SilentlyContinue)) 'Uninstall left CLI registry setting behind'
  Assert-True (-not (Test-Path "$env:APPDATA/workspace-manager/configure-path.ps1")) 'Uninstall left PATH helper behind'
  Write-Host 'Windows install, PATH, both CLI aliases, PTY, reinstall and uninstall passed.'
} finally {
  $env:Path = $processPath
  [Environment]::SetEnvironmentVariable('Path', $originalPath, 'User')
  # Keep the installation on failure for the runner logs/diagnostics; CI discards the VM.
}

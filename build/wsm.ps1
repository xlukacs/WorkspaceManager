# PowerShell 5 + GitHub Copilot/VS Code ConPTY call ReadConsoleOutput on native
# commands. That fails with Access Denied 0x5 for wsm.cmd (cmd.exe launching a
# GUI-subsystem WorkspaceManager.exe). This script is a PowerShell command, so
# it never uses NativeCommandProcessor. Launch Electron as Node with redirected
# stdio and no window so the GUI exe never owns the console.
$ErrorActionPreference = 'Stop'

function ConvertTo-Win32Argument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'WorkspaceManager.exe'
$cli = Join-Path $root 'resources\app.asar\out\cli\index.js'
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Workspace Manager CLI executable not found: $exe"
}

$argString = (@($cli) + $args | ForEach-Object { ConvertTo-Win32Argument $_ }) -join ' '
$outFile = [System.IO.Path]::GetTempFileName()
$errFile = [System.IO.Path]::GetTempFileName()
$inFile = [System.IO.Path]::GetTempFileName()
$previous = $env:ELECTRON_RUN_AS_NODE
$env:ELECTRON_RUN_AS_NODE = '1'
$code = 1
try {
  $process = Start-Process -FilePath $exe -ArgumentList $argString -WorkingDirectory $root -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $outFile -RedirectStandardError $errFile -RedirectStandardInput $inFile
  if ($process) { $code = $process.ExitCode }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  if ((Test-Path -LiteralPath $outFile) -and (Get-Item -LiteralPath $outFile).Length -gt 0) {
    Write-Output ([System.IO.File]::ReadAllText($outFile, $utf8))
  }
  if ((Test-Path -LiteralPath $errFile) -and (Get-Item -LiteralPath $errFile).Length -gt 0) {
    [Console]::Error.Write(([System.IO.File]::ReadAllText($errFile, $utf8)))
  }
} finally {
  if ($null -eq $previous -or $previous -eq '') {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  } else {
    $env:ELECTRON_RUN_AS_NODE = $previous
  }
  Remove-Item -LiteralPath $outFile, $errFile, $inFile -ErrorAction SilentlyContinue
}

$global:LASTEXITCODE = $code

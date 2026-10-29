param(
  [ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory=$true)][string]$BinDir,
  [string]$CmdDir
)
$ErrorActionPreference = 'Stop'
$registry = 'HKCU:\Software\Workspace Manager'
if (-not $CmdDir) { $CmdDir = Join-Path $BinDir 'cmd' }
$saved = Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue
$oldBin = if ($saved -and $saved.CliBin) { $saved.CliBin } else { '' }
$oldCmd = if ($saved -and $saved.CliCmd) { $saved.CliCmd } else { '' }
function Normalize([string]$value) {
  if (-not $value) { return '' }
  return $value.Trim().TrimEnd('\', '/')
}
$targets = @($BinDir, $CmdDir, $oldBin, $oldCmd) | ForEach-Object { Normalize $_ } | Where-Object { $_ } | Select-Object -Unique
$parts = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object {
  $entry = Normalize $_
  $entry -and -not ($targets -contains $entry)
})
if ($Action -eq 'add') {
  # PowerShell scripts must precede .cmd shims so `wsm` is not a native command.
  $parts = @((Normalize $BinDir), (Normalize $CmdDir)) + $parts
}
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
if ($Action -eq 'add') {
  New-Item -Path $registry -Force | Out-Null
  Set-ItemProperty -Path $registry -Name CliBin -Value (Normalize $BinDir)
  Set-ItemProperty -Path $registry -Name CliCmd -Value (Normalize $CmdDir)
} else {
  Remove-ItemProperty -Path $registry -Name CliBin -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $registry -Name CliCmd -ErrorAction SilentlyContinue
}

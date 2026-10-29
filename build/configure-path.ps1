param(
  [ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory=$true)][string]$BinDir
)
$ErrorActionPreference = 'Stop'
$registry = 'HKCU:\Software\Workspace Manager'
$saved = Get-ItemProperty -Path $registry -Name CliBin -ErrorAction SilentlyContinue
$oldBin = if ($saved) { $saved.CliBin } else { '' }
function Normalize([string]$value) { return $value.Trim().TrimEnd('\', '/') }
$targets = @((Normalize $BinDir), (Normalize $oldBin))
$parts = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object {
  $entry = Normalize $_
  $entry -and -not ($targets -contains $entry)
})
if ($Action -eq 'add') { $parts += (Normalize $BinDir) }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
if ($Action -eq 'add') {
  New-Item -Path $registry -Force | Out-Null
  Set-ItemProperty -Path $registry -Name CliBin -Value (Normalize $BinDir)
} else {
  Remove-ItemProperty -Path $registry -Name CliBin -ErrorAction SilentlyContinue
}

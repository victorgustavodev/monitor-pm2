# Execute em um PowerShell elevado usando a MESMA conta que executa o PM2.
param(
  [string]$TaskName = 'ati-dev-cockpit',
  [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),
  [string]$RunAsUser = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = 'Stop'
$launcher = Join-Path $ProjectPath 'scripts\start-monitor.ps1'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Launcher não encontrado: $launcher" }

$credential = Get-Credential -UserName $RunAsUser -Message 'Conta que possui os processos PM2'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -ProjectPath `"$ProjectPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $credential.UserName -LogonType Password -RunLevel Highest

$plainPassword = $credential.GetNetworkCredential().Password
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -User $credential.UserName -Password $plainPassword -Force | Out-Null
$plainPassword = $null
Write-Host "Tarefa '$TaskName' instalada para $($credential.UserName)."

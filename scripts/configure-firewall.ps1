# Execute em PowerShell elevado. Exemplo: .\scripts\configure-firewall.ps1 -VpnRemoteAddress '10.20.0.0/16'
param(
  [Parameter(Mandatory = $true)][string[]]$VpnRemoteAddress,
  [int]$Port = 4170,
  [string]$RuleName = 'ati-dev-cockpit - VPN'
)

$ErrorActionPreference = 'Stop'
$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) { Remove-NetFirewallRule -DisplayName $RuleName }
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $VpnRemoteAddress -Profile Domain,Private | Out-Null
Write-Host "Firewall liberado na porta $Port somente para: $($VpnRemoteAddress -join ', ')"

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# Retorna somente PIDs e portas TCP locais, sem comandos nem variaveis de ambiente.
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  @{ pid = [int]$_.OwningProcess; port = [int]$_.LocalPort }
})
$processes = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object {
  @{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId }
})
@{ listeners = $listeners; processes = $processes } | ConvertTo-Json -Compress -Depth 4

param([string]$ProjectPath = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$runtimePath = Join-Path $ProjectPath 'runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
Set-Location -LiteralPath $ProjectPath

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$stdout = Join-Path $runtimePath 'monitor.stdout.log'
$stderr = Join-Path $runtimePath 'monitor.stderr.log'

Start-Process -FilePath $npm -ArgumentList @('run', 'start:prod') -WorkingDirectory $ProjectPath -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait

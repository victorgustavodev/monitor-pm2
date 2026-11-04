$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ((Get-Process -Id $PID).SessionId -eq 0 -or -not [Environment]::UserInteractive) {
  throw 'O seletor exige uma sessão Windows interativa.'
}
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Selecionar ecosystem.config.js na VM'
$dialog.Filter = 'Configuração PM2 (ecosystem.config.js)|ecosystem.config.js'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write($dialog.FileName)
  }
} finally {
  $dialog.Dispose()
}

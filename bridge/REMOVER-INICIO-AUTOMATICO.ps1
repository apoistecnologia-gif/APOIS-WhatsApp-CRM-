Stop-ScheduledTask -TaskName 'APOIS CRM Bridge' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'APOIS CRM Bridge' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'Início automático removido. Dados e sessões foram preservados.'

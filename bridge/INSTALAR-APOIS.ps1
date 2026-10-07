$ErrorActionPreference = 'Stop'
$taskName = 'APOIS CRM Bridge'
$projectPath = $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
$version = & $nodePath --version
if ([int]($version.TrimStart('v').Split('.')[0]) -lt 20) { throw 'Instale Node.js 20 ou superior.' }
Push-Location $projectPath
try {
    & $npmPath ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências do bridge.' }
    $action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + (Join-Path $projectPath 'server.mjs') + '"') -WorkingDirectory $projectPath
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Sessões WhatsApp independentes locais do APOIS CRM' -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    $tokenPath = Join-Path $env:LOCALAPPDATA 'APOIS-CRM\bridge-token'
    for ($attempt=0; $attempt -lt 20; $attempt++) { if (Test-Path $tokenPath) { break }; Start-Sleep -Milliseconds 500 }
    if (Test-Path $tokenPath) {
        $bridgeKey = (Get-Content $tokenPath -Raw).Trim()
        Set-Clipboard -Value $bridgeKey
        Write-Host 'Bridge instalado. A chave local foi copiada. Cole em Central APOIS > Configurações > Bridge local.'
    } else { Write-Host 'Verifique o status da tarefa APOIS CRM Bridge no Agendador de Tarefas.' }
} finally { Pop-Location }

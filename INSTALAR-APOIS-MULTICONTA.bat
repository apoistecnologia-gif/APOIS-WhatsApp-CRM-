@echo off
setlocal
title APOIS - Instalar Central Multiconta
cd /d "%~dp0apois-multiconta-bridge"

echo.
echo ============================================
echo   APOIS - CENTRAL MULTICONTA
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js 20 ou superior nao foi encontrado.
  echo Instale o Node.js LTS e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

node -e "if(Number(process.versions.node.split('.')[0])<20)process.exit(1)"
if errorlevel 1 (
  echo [ERRO] Atualize o Node.js para a versao 20 ou superior.
  pause
  exit /b 1
)
echo Node detectado:
node -v
echo.

if not exist node_modules (
  echo Instalando dependencias da Central Multiconta...
  call npm ci
  if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

echo.
echo Criando inicializacao automatica...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo @echo off
  echo cd /d "%~dp0apois-multiconta-bridge"
  echo start "" /min node server.mjs
) > "%STARTUP%\APOIS WhatsApp Central.cmd"

echo Iniciando a Central agora...
start "" /min node server.mjs

echo.
echo [OK] Central Multiconta instalada.
echo Agora volte ao WhatsApp Web e clique em:
echo APOIS ^> Central ^> Conectar WhatsApp via QR
echo.
pause

@echo off
cd /d "%~dp0apois-multiconta-bridge"
if not exist node_modules (
  echo Dependencias nao instaladas. Execute INSTALAR-APOIS-MULTICONTA.bat primeiro.
  pause
  exit /b 1
)
node server.mjs

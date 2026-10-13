@echo off
setlocal
cd /d "%~dp0"
node scripts/start-local.mjs
if errorlevel 1 echo Baslatma hatasi. Yukaridaki aciklamayi kontrol edin.
pause

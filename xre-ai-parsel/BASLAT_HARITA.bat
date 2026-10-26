@echo off
cd /d "%~dp0"
title XRE AI PARSEL - HARITA
node scripts\check-deps.mjs
if errorlevel 1 (
 echo Paketler kuruluyor / guncelleniyor...
 call npm.cmd install || (echo HATA: npm kurulumu basarisiz. & pause & exit /b 1)
 node scripts\check-deps.mjs || (echo HATA: Paketler hala eksik. node_modules klasorunu silip KURULUM.bat calistirin. & pause & exit /b 1)
)
call npm.cmd run dev
pause

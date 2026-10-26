@echo off
cd /d "%~dp0"
title XRE AI PARSEL - HARITA
rem Paketler kurulmamissa once kur (KURULUM.bat atlandiysa).
if not exist node_modules\.package-lock.json (
 echo npm paketleri eksik, kuruluyor...
 call npm.cmd install || (echo HATA: npm kurulumu basarisiz. & pause & exit /b 1)
)
call npm.cmd run dev
pause

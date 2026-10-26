@echo off
cd /d "%~dp0"
title XRE SOFTWARE - Parsel Sorgu
rem Tek pencere: arayuzu derler ve API ile birlikte http://localhost:3001 adresinde acar.
if not exist node_modules\.package-lock.json (
 echo npm paketleri eksik, kuruluyor...
 call npm.cmd install || (echo HATA: npm kurulumu basarisiz. & pause & exit /b 1)
)
echo Arayuz derleniyor...
call npm.cmd run build || (echo HATA: Arayuz derlenemedi. Yukaridaki hatayi gonderin. & pause & exit /b 1)
start "" http://localhost:3001
call npm.cmd run api
pause

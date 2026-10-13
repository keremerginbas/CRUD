@echo off
setlocal
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%STARTUP%\XRE-CRM.vbs"
if not exist dist\server.js (
  echo Once XRE-CRM-AC.cmd ile bir kez kurulum yapin.
  pause
  exit /b 1
)
> "%TARGET%" echo Set sh = CreateObject("WScript.Shell")
>> "%TARGET%" echo sh.CurrentDirectory = "%~dp0"
>> "%TARGET%" echo sh.Run "cmd /c node scripts\start-local.mjs > data\sunucu.log 2>&1", 0, False
if not exist data mkdir data
echo.
echo Tamam. Bilgisayar her acildiginda XRE CRM arka planda kendiliginden baslar.
echo Kayitlar: data\sunucu.log   Adres: http://localhost:3000
echo Kaldirmak icin OTOMATIK-BASLAT-KALDIR.cmd dosyasini calistirin.
choice /c EH /m "Simdi arka planda baslatilsin mi"
if errorlevel 2 goto :eof
wscript "%TARGET%"
timeout /t 4 >nul
start "" http://localhost:3000

@echo off
set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\XRE-CRM.vbs"
if exist "%TARGET%" del "%TARGET%"
echo Otomatik baslatma kaldirildi.
echo Arka planda calisan CRM'i durdurmak icin Gorev Yoneticisi'nde "Node.js JavaScript Runtime" islemini sonlandirin.
pause

@echo off
chcp 65001 >nul
REM JARVIS ekranini Windows acilisina ekler.
set "HEDEF=%~dp0baslat.vbs"
set "KISAYOL=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Jarvis.lnk"

powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:KISAYOL);" ^
  "$s.TargetPath='wscript.exe';" ^
  "$s.Arguments='\"' + $env:HEDEF + '\"';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "$s.Save()"

if exist "%KISAYOL%" (
  echo.
  echo  [OK] JARVIS kuruldu. Bilgisayar her acildiginda seni karsilayacak, patron.
  echo  Simdi denemek icin baslat.vbs dosyasina cift tikla.
) else (
  echo  [HATA] Kisayol olusturulamadi.
)
echo.
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Windows acilinca JARVIS kendiliginden baslasin: Baslangic klasorune kisayol koyar.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\JARVIS.lnk'); $s.TargetPath='%~dp0BASLAT.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo JARVIS artik Windows acilinca otomatik baslayacak (simge durumunda).
echo Kapatmak icin: Win+R  ^>  shell:startup  ^>  JARVIS kisayolunu silin.
pause

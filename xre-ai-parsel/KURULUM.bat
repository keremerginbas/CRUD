@echo off
cd /d "%~dp0"
echo XRE AI Parsel V12 - ilk kurulum
where node >nul 2>&1 || (echo HATA: Node.js kurulu degil. & pause & exit /b 1)
where py >nul 2>&1 || (echo HATA: Python Launcher (py) bulunamadi. KURULUM_WINDOWS.md dosyasina bakin. & pause & exit /b 1)
call npm.cmd install || (echo HATA: npm kurulumu basarisiz. & pause & exit /b 1)
py -3 -m pip install -r worker\requirements.txt || (echo HATA: Python paketleri kurulamadi. & pause & exit /b 1)
if not exist .env (copy .env.example .env >nul && echo .env dosyasi olusturuldu.)
echo.
echo Kurulum tamamlandi. BASLAT_API.bat ve BASLAT_HARITA.bat dosyalarini ayri ayri calistirin.
echo Parsel sorgusu once herkese acik TKGM baglantisinda token olmadan denenir.
pause

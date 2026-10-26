@echo off
cd /d "%~dp0"
echo XRE SOFTWARE Parsel Sorgu V13 - kurulum
where node >nul 2>&1 || (echo HATA: Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b 1)
echo [1/3] npm paketleri kuruluyor...
call npm.cmd install && node scripts\check-deps.mjs || (echo HATA: npm kurulumu basarisiz. Internet baglantisini kontrol edin. & pause & exit /b 1)
echo [2/3] Python paketleri kuruluyor...
where py >nul 2>&1 && (py -3 -m pip install -r worker\requirements.txt || echo UYARI: Python paketleri kurulamadi; parsel sorgusu calismaz.) || echo UYARI: Python Launcher (py) bulunamadi. KURULUM_WINDOWS.md dosyasina bakin; parsel sorgusu Python olmadan calismaz.
echo [3/3] Ayarlar...
if not exist .env (copy .env.example .env >nul && echo .env dosyasi olusturuldu.)
echo.
echo Kurulum tamamlandi. BASLAT_API.bat ve BASLAT_HARITA.bat dosyalarini ayri ayri calistirin.
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === JARVIS kurulumu (Windows) ===
echo.
set "PY="
py -3.12 -c "" >nul 2>nul && set "PY=py -3.12"
if not defined PY py -3 -c "" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "" >nul 2>nul && set "PY=python"
if not defined PY goto pythonyok
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" || goto pythonyok
echo Python bulundu:
%PY% --version
if not exist .venv\Scripts\python.exe (
  echo Sanal ortam olusturuluyor...
  %PY% -m venv .venv || (echo Sanal ortam olusturulamadi. & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || (echo. & echo Kurulumda hata olustu. Yukaridaki mesajin ekran goruntusunu gonderin. & pause & exit /b 1)
echo Uyandirma kelimesi modeli indiriliyor...
python -c "from openwakeword.utils import download_models; download_models(['hey_jarvis'])"
if not exist .env copy .env.ornek .env >nul
echo.
echo ============================================================
echo  Kurulum tamam.
echo  Acilan .env dosyasina anahtarlarinizi yazip kaydedin (Ctrl+S),
echo  sonra BASLAT.bat'a cift tiklayin.
echo ============================================================
notepad .env
pause
exit /b 0

:pythonyok
echo Python 3.10 veya ustu bulunamadi.
echo python.org'dan Python 3.12'yi kurun; kurulumun ilk ekraninda
echo "Add python.exe to PATH" kutusunu isaretleyin. Sonra KUR.bat'i tekrar calistirin.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1

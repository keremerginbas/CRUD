@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === JARVIS kurulumu ===
where py >nul 2>nul
if errorlevel 1 (
  echo Python bulunamadi. python.org'dan Python 3.12 kurun ve kurulumda "Add python.exe to PATH" kutusunu isaretleyin.
  pause & exit /b 1
)
py -3.12 -m venv .venv 2>nul || py -3 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || (echo Kurulumda hata olustu. & pause & exit /b 1)
python -c "from openwakeword.utils import download_models; download_models(['hey_jarvis'])"
if not exist .env copy .env.ornek .env >nul
echo.
echo Kurulum tamam. Simdi .env dosyasini Not Defteri ile acip anahtarlarinizi yazin,
echo sonra BASLAT.bat ile calistirin.
notepad .env
pause

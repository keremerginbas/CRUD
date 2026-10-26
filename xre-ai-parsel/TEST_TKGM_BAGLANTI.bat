@echo off
cd /d "%~dp0"
echo XRE AI Parsel V12 - TKGM il listesi baglanti testi
py -3 worker\tkgm_diagnose.py
if errorlevel 1 (
 echo Python calismadi. KURULUM.bat calistirin veya Python 3.10+ yukleyin.
)
echo.
pause

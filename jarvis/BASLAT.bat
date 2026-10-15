@echo off
chcp 65001 >nul
cd /d "%~dp0"
title JARVIS
if not exist .venv\Scripts\python.exe (
  echo Once KUR.bat'i calistirin.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
python jarvis.py
pause

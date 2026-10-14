@echo off
chcp 65001 >nul
cd /d "%~dp0"
title JARVIS
call .venv\Scripts\activate.bat
python jarvis.py
pause

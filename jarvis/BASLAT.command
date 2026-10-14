#!/bin/bash
# JARVIS'i başlatır (Mac). Çift tıklayın ya da Terminal'de: bash BASLAT.command
cd "$(dirname "$0")" || exit 1
if [ ! -d .venv ]; then echo "Önce KUR.command'ı çalıştırın."; read -r; exit 1; fi
source .venv/bin/activate
python jarvis.py
read -r -p "Kapatmak için Enter'a basın…"

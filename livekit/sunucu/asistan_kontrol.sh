#!/usr/bin/env bash
# Asistanların modellerini ve seslerini gerçek isteklerle sınar; her model için en hızlı çalışan ayarı kaydeder.
#   sudo bash /opt/xre-ai/asistan_kontrol.sh            → sınar, raporlar, ayarları kaydeder
#   sudo bash /opt/xre-ai/asistan_kontrol.sh --duzelt   → çalışmayan modelleri gpt-4.1-mini yapar
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
cd /opt/xre-ai && python3 asistan_kontrol.py .env asistanlar "$@"

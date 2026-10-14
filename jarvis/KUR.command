#!/bin/bash
# JARVIS kurulumu (Mac). Çift tıklayın ya da Terminal'de: bash KUR.command
cd "$(dirname "$0")" || exit 1
echo "=== JARVIS kurulumu ==="
PY=""
for aday in python3.12 python3.13 python3.11 python3; do
  if command -v "$aday" >/dev/null 2>&1 && "$aday" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    PY="$aday"; break
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10+ bulunamadı. python.org/downloads adresinden Python 3.12'yi (macOS) kurup tekrar çalıştırın."
  open "https://www.python.org/downloads/macos/"
  read -r -p "Kapatmak için Enter'a basın…"; exit 1
fi
echo "Python: $($PY --version)"
"$PY" -m venv .venv || { echo "Sanal ortam oluşturulamadı."; read -r; exit 1; }
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt || { echo "Kurulumda hata oluştu (yukarıdaki mesaja bakın)."; read -r; exit 1; }
python -c "from openwakeword.utils import download_models; download_models(['hey_jarvis'])"
chmod +x BASLAT.command 2>/dev/null
[ -f .env ] || cp .env.ornek .env
echo
echo "Kurulum tamam. Açılan .env dosyasına anahtarlarınızı yazıp kaydedin,"
echo "sonra BASLAT.command ile çalıştırın."
open -e .env
read -r -p "Kapatmak için Enter'a basın…"

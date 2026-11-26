#!/usr/bin/env bash
# Panel kullanıcısına yeni şifre verir. Kullanım: sudo bash panel_sifre.sh [kullanıcı-adı]   (varsayılan: yonetici)
set -euo pipefail
cd /opt/xre-ai
AD=${1:-yonetici}
SIFRE=$(docker compose exec -T api python -c "import panel,sys; print(panel.sifre_sifirla(sys.argv[1]))" "$AD")
echo "Kullanıcı: $AD"
echo "Yeni şifre: $SIFRE"
echo "Panele girdikten sonra Hesabım sayfasından değiştirin."

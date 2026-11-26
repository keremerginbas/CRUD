#!/usr/bin/env bash
# Paneli ofis dışından, güvenli bağlantıyla (https) açar — Cloudflare Tunnel ile. Modemde port açmak gerekmez.
#
# Önce Cloudflare'da (alan adınızın olduğu hesap):
#   1) one.dash.cloudflare.com → Networks → Tunnels → "Create a tunnel" → Cloudflared → ad: xre-arama
#   2) Çıkan ekranda "token" ile başlayan uzun anahtarı kopyalayın (eyJ... ile başlar)
#   3) "Public Hostname" ekleyin:  alt alan adı: arama   ·  alan adı: sizin alan adınız
#                                   Service: HTTP  ·  URL: localhost:8080
# Sonra bu betiği çalıştırın:   sudo bash /opt/xre-ai/disaridan_erisim.sh
# Kapatmak için:                sudo bash /opt/xre-ai/disaridan_erisim.sh kapat
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
cd /opt/xre-ai
if [ "${1:-}" = kapat ]; then
  docker compose --profile tunel stop tunel && docker compose --profile tunel rm -f tunel
  sed -i '/^TUNNEL_TOKEN=/d' .env
  echo "Dışarıdan erişim kapatıldı. Panel yalnızca ofis ağından açılır."
  exit 0
fi
read -rsp "Cloudflare tunnel anahtarı (eyJ... ; ekranda görünmez): " T; echo
[ ${#T} -gt 50 ] || { echo "Anahtar çok kısa; Cloudflare'daki 'token' değerinin tamamını yapıştırın."; exit 1; }
sed -i '/^TUNNEL_TOKEN=/d' .env
echo "TUNNEL_TOKEN=$T" >> .env
docker compose --profile tunel up -d tunel 2>&1 | tail -2
sleep 8
if docker compose --profile tunel logs --since 30s tunel 2>&1 | grep -qi "registered tunnel connection"; then
  echo "✓ Bağlantı kuruldu. Panel adresi: https://<Cloudflare'da yazdığınız alan adı>/panel"
  echo "  Güvenlik için: herkese ayrı kullanıcı açın, 'yonetici' şifresini değiştirin."
else
  echo "✗ Bağlantı kurulamadı. Günlük:"; docker compose --profile tunel logs --tail 15 tunel
fi

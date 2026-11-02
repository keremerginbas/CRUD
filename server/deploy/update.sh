#!/usr/bin/env bash
# Sunucuyu son sürüme günceller: kod, paketler, web arayüzü, servis.
# Kullanım (Proxmox'ta): pct exec 140 -- /opt/santral/server/deploy/update.sh
set -euo pipefail
cd /opt/santral
git pull -q
echo "== Sunucu paketleri"; (cd server && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
echo "== Web arayüzü derleniyor"; (cd web && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent >/dev/null)
systemctl restart santral
sleep 2
echo "== Servis: $(systemctl is-active santral)"
echo "== Sayfa: $(curl -s -o /dev/null -w '%{http_code}' localhost:3000/)"

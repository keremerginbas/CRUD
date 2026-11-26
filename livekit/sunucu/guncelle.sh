#!/usr/bin/env bash
# Yapay zekâ sunucusunu en son sürüme günceller. Anahtarlara, numaralara ve kendi asistanlarınıza dokunmaz.
#   curl -sL https://raw.githubusercontent.com/keremerginbas/CRUD/claude/tender-cori-xgh6nr/livekit/sunucu/guncelle.sh | sudo bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
HEDEF=/opt/xre-ai
[ -f "$HEDEF/.env" ] || { echo "Önce kurulum (kur_ai.sh) yapılmalı."; exit 1; }
GECICI=$(mktemp -d); trap 'rm -rf "$GECICI"' EXIT
echo "== Son sürüm indiriliyor =="
curl -sL https://github.com/keremerginbas/CRUD/archive/refs/heads/claude/tender-cori-xgh6nr.tar.gz | tar xz --strip-components=1 -C "$GECICI"
K="$GECICI/livekit/sunucu"
[ -f "$K/agent/agent.py" ] || { echo "İndirme başarısız."; exit 1; }
rm -rf "$HEDEF/agent" && cp -r "$K/agent" "$K/docker-compose.yml" "$K/ai_ara.sh" "$K/guncelle.sh" "$HEDEF/"
cp "$K/asistanlar/test.yaml" "$HEDEF/asistanlar/test.yaml"   # yalnızca deneme asistanı yenilenir
echo "== Yapay zekâ yeniden kuruluyor (1-2 dakika) =="
cd "$HEDEF"
docker compose up -d --build ajan api 2>&1 | tail -4
for i in $(seq 1 30); do docker compose logs --since 60s ajan 2>&1 | grep -q "registered worker" && break; sleep 2; done
docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
docker compose logs --since 90s ajan 2>&1 | grep -q "registered worker" && echo "✓ Güncellendi, yapay zekâ hazır." || echo "✗ Yapay zekâ bağlanmadı: docker compose logs ajan"

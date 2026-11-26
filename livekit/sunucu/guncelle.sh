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
rm -rf "$HEDEF/agent" && cp -r "$K/agent" "$K/docker-compose.yml" "$K/ai_ara.sh" "$K/ses_analiz.sh" "$K/guncelle.sh" "$HEDEF/"
cp "$K/asistanlar/test.yaml" "$HEDEF/asistanlar/test.yaml"   # yalnızca deneme asistanı yenilenir
# Asterisk: asistanın ve müşterinin sesini ayrı ayrı da kaydet (ses_analiz.sh için)
E=/etc/asterisk/extensions.conf
if ! grep -q 'son-asistan.wav' "$E"; then
  sed -i 's#-gelen-${CALLERID(num)}.wav)#-gelen-${CALLERID(num)}.wav,r(/var/spool/asterisk/kayit/son-musteri.wav)t(/var/spool/asterisk/kayit/son-asistan.wav))#; s#-giden-${EXTEN}.wav)#-giden-${EXTEN}.wav,r(/var/spool/asterisk/kayit/son-asistan.wav)t(/var/spool/asterisk/kayit/son-musteri.wav))#' "$E"
  asterisk -rx "dialplan reload" >/dev/null && echo "Asterisk: ayrı ses kaydı açıldı."
fi
# Asterisk: müşteriden gelen seste gürültü azaltma (uğultu, trafik, rüzgâr)
if ! grep -q 'DENOISE(rx)=on' "$E"; then
  sed -i '/Set(CHANNEL(hangup_handler_push)=kalite,s,1)/a\ same => n,Set(DENOISE(rx)=on)' "$E"
  asterisk -rx "dialplan reload" >/dev/null && echo "Asterisk: gürültü azaltma açıldı."
fi
# Deepgram'ın Avrupa sunucusu bu anahtarla çalışıyorsa onu kullan (Türkiye'den daha yakın)
sed -i '/^DEEPGRAM_URL=/d' "$HEDEF/.env"
DG=$(grep -E '^DEEPGRAM_API_KEY=' "$HEDEF/.env" | cut -d= -f2-)
if [ "$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://api.eu.deepgram.com/v1/projects -H "Authorization: Token $DG" || true)" = 200 ]; then
  echo "DEEPGRAM_URL=https://api.eu.deepgram.com/v1/listen" >> "$HEDEF/.env"; echo "Ses tanıma: Deepgram Avrupa sunucusu kullanılacak."
else
  echo "Ses tanıma: Deepgram varsayılan sunucusu kullanılacak (Avrupa sunucusu bu anahtarı kabul etmedi)."
fi
for h in api.deepgram.com api.eu.deepgram.com api.openai.com api.elevenlabs.io; do
  printf '  %-24s bağlantı süresi: %s sn\n' "$h" "$(curl -s -o /dev/null -m 10 -w '%{time_connect}' "https://$h" || echo '?')"
done
echo "== Yapay zekâ yeniden kuruluyor (1-2 dakika) =="
cd "$HEDEF"
docker compose up -d --build ajan api 2>&1 | tail -4
for i in $(seq 1 30); do docker compose logs --since 60s ajan 2>&1 | grep -q "registered worker" && break; sleep 2; done
docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
docker compose logs --since 90s ajan 2>&1 | grep -q "registered worker" && echo "✓ Güncellendi, yapay zekâ hazır." || echo "✗ Yapay zekâ bağlanmadı: docker compose logs ajan"

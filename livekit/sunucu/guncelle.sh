#!/usr/bin/env bash
# Yapay zekâ sunucusunu en son sürüme günceller. Anahtarlara, numaralara ve kendi asistanlarınıza dokunmaz.
#   curl -sL https://raw.githubusercontent.com/keremerginbas/CRUD/claude/tender-cori-xgh6nr/livekit/sunucu/guncelle.sh | sudo bash
set -euo pipefail
# Betik çalışırken kendi dosyasını da yeniler. Bash dosyayı parça parça okuduğu için gövde tek blok içinde:
# böylece tamamı baştan okunur, dosya değişse de yarıda bozulmaz.
{
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
HEDEF=/opt/xre-ai
[ -f "$HEDEF/.env" ] || { echo "Önce kurulum (kur_ai.sh) yapılmalı."; exit 1; }
GECICI=$(mktemp -d); trap 'rm -rf "$GECICI"' EXIT
echo "== Son sürüm indiriliyor =="
curl -sL https://github.com/keremerginbas/CRUD/archive/refs/heads/claude/tender-cori-xgh6nr.tar.gz | tar xz --strip-components=1 -C "$GECICI"
K="$GECICI/livekit/sunucu"
[ -f "$K/agent/agent.py" ] || { echo "İndirme başarısız."; exit 1; }
rm -rf "$HEDEF/agent" "$HEDEF/asterisk" && cp -r "$K/agent" "$K/asterisk" "$K/docker-compose.yml" "$K/ai_ara.sh" "$K/ses_analiz.sh" "$K/guncelle.sh" "$K/panel_sifre.sh" "$K/disaridan_erisim.sh" "$K/trunk_ekle.sh" "$K/trunk_dene.sh" "$K/vapi_trunk_al.sh" "$K/vapi_asistan_al.sh" "$K/vapi_asistan_cevir.py" "$K/asistan_kontrol.sh" "$K/asistan_kontrol.py" "$K/n8n_baglan.sh" "$K/numaralari_yukle.sh" "$K/numaralar_xre.yaml" "$HEDEF/"
cp "$K/asistanlar/test.yaml" "$HEDEF/asistanlar/test.yaml"   # yalnızca deneme asistanı yenilenir
# Asterisk arama planını son sürümle değiştir (NetGSM kaydına dokunmaz)
GELEN_NUMARA=$(awk -F'"' '/numara:/{print $2; exit}' "$HEDEF/numaralar.yaml")
[ -n "$GELEN_NUMARA" ] || GELEN_NUMARA=$(awk '/numara:/{print $2; exit}' "$HEDEF/numaralar.yaml" | tr -d "'\"")
sed "s|__GELEN_NUMARA__|$GELEN_NUMARA|" "$K/asterisk/extensions.conf" > /etc/asterisk/extensions.conf
asterisk -rx "dialplan reload" >/dev/null && echo "Asterisk arama planı güncellendi."
# Panel için gizli anahtar ve veri klasörü
grep -q '^PANEL_GIZLI=' "$HEDEF/.env" || echo "PANEL_GIZLI=$(openssl rand -hex 32)" >> "$HEDEF/.env"
mkdir -p "$HEDEF/veri" && chmod 700 "$HEDEF/veri"
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
LAN_IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
echo
echo "Yönetim paneli: http://$LAN_IP:8080/panel"
ILK=$(docker compose logs api 2>&1 | grep -o "PANEL İLK GİRİŞ.*" | tail -1 || true)
[ -n "$ILK" ] && echo "$ILK" || echo "Şifrenizi unuttuysanız: sudo bash $HEDEF/panel_sifre.sh"
exit 0
}

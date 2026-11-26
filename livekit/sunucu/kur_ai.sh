#!/usr/bin/env bash
# =====================================================================
#  XRE yapay zekâ arama sunucusu — kurulum
#  "ai-arama" sanal makinesinde, bu klasörün içinde çalıştırın:
#      sudo bash kur_ai.sh
#
#  Ön koşul: ses testi kurulumu (kur.sh) yapılmış ve NetGSM kaydı "Registered".
#  Ne yapar:
#    1) API anahtarlarını sorar (OpenAI, Deepgram, ElevenLabs) ve dener
#    2) Dosyaları /opt/xre-ai klasörüne kurar, gizli anahtarları üretir
#    3) Asterisk'e LiveKit köprüsünü ekler (NetGSM ayarına dokunmaz)
#    4) LiveKit + yapay zekâ + API'yi Docker ile başlatır
#  Tekrar çalıştırmak güvenlidir; mevcut anahtarları korur.
# =====================================================================
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın: sudo bash kur_ai.sh"; exit 1; }
BURASI=$(cd "$(dirname "$0")" && pwd)
HEDEF=/opt/xre-ai
PJSIP=/etc/asterisk/pjsip.conf

grep -q '^\[netgsm\]' "$PJSIP" 2>/dev/null || { echo "Önce ses testi kurulumunu (kur.sh) yapın: $PJSIP içinde NetGSM ayarı yok."; exit 1; }
command -v docker >/dev/null || { echo "Docker kurulu değil."; exit 1; }
SIP_USER=$(awk -F= '/^username=/{print $2; exit}' "$PJSIP")
AST_PORT=$(awk -F: '/^bind=/{print $2; exit}' "$PJSIP")
LAN_IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
LAN_NET=$(ip -4 -o addr show | awk -v ip="$LAN_IP" '$4 ~ "^"ip"/" {print $4}' | head -1)

mkdir -p "$HEDEF"
ENV="$HEDEF/.env"
eski() { [ -f "$ENV" ] && grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- || true; }

# ---------- 1) API anahtarları ----------
sor() { # sor DEGISKEN "açıklama"
  local mevcut; mevcut=$(eski "$1")
  if [ -n "$mevcut" ]; then
    read -rsp "$2 [Enter = kayıtlı olanı koru]: " v; echo
    printf -v "$1" '%s' "${v:-$mevcut}"
  else
    read -rsp "$2: " v; echo
    [ -n "$v" ] || { echo "Boş bırakılamaz."; exit 1; }
    printf -v "$1" '%s' "$v"
  fi
}
echo "== API anahtarları (yazarken ekranda görünmez) =="
sor OPENAI_API_KEY   "OpenAI API anahtarı (sk-...)"
sor DEEPGRAM_API_KEY "Deepgram API anahtarı"
sor ELEVEN_API_KEY   "ElevenLabs API anahtarı"
VARSAYILAN_SES=$(eski ELEVEN_VOICE_ID); VARSAYILAN_SES=${VARSAYILAN_SES:-R0D8QjgVyRju4HRoCrIC}
read -rp "ElevenLabs ses ID'si [$VARSAYILAN_SES]: " ELEVEN_VOICE_ID; ELEVEN_VOICE_ID=${ELEVEN_VOICE_ID:-$VARSAYILAN_SES}

echo "== Anahtarlar deneniyor =="
kod() { curl -s -o /dev/null -m 20 -w '%{http_code}' "$@" || echo 000; }
K1=$(kod https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY")
K2=$(kod https://api.deepgram.com/v1/projects -H "Authorization: Token $DEEPGRAM_API_KEY")
K3=$(kod -X POST "https://api.elevenlabs.io/v1/text-to-speech/$ELEVEN_VOICE_ID?output_format=mp3_22050_32" \
      -H "xi-api-key: $ELEVEN_API_KEY" -H 'Content-Type: application/json' \
      -d '{"text":"Merhaba.","model_id":"eleven_flash_v2_5","language_code":"tr"}')
sonuc() { [ "$2" = 200 ] && echo "  ✓ $1" || echo "  ✗ $1 — hata kodu $2"; }
sonuc "OpenAI" "$K1"; sonuc "Deepgram" "$K2"; sonuc "ElevenLabs (anahtar + ses ID + seslendirme izni)" "$K3"
# Denenebilecek diğer sesler (ai_ara.sh 05XXXXXXXXX SES_ID ile tek tek dinlenebilir)
for S in mBUB5zYuPwfVE6DTcEjf R0D8QjgVyRju4HRoCrIC EJGs6dWlD5VrB3llhBqB; do
  [ "$S" = "$ELEVEN_VOICE_ID" ] && continue
  KS=$(kod -X POST "https://api.elevenlabs.io/v1/text-to-speech/$S?output_format=mp3_22050_32" -H "xi-api-key: $ELEVEN_API_KEY" \
        -H 'Content-Type: application/json' -d '{"text":"Merhaba.","model_id":"eleven_flash_v2_5","language_code":"tr"}')
  sonuc "ElevenLabs sesi $S" "$KS"
done
if [ "$K1$K2$K3" != 200200200 ]; then
  echo "Yukarıda ✗ olan anahtar çalışmıyor. 401/403 = anahtar ya da izin yanlış · 404 = ses ID yanlış · 000 = internet yok."
  read -rp "Yine de devam edilsin mi? [e/H]: " d; [ "${d,,}" = e ] || exit 1
fi

# ---------- 2) Dosyalar ve gizli anahtarlar ----------
echo "== Dosyalar $HEDEF klasörüne kuruluyor =="
cp -r "$BURASI/agent" "$BURASI/docker-compose.yml" "$HEDEF/"
mkdir -p "$HEDEF/asistanlar" "$HEDEF/veri" && chmod 700 "$HEDEF/veri"
for f in "$BURASI"/asistanlar/*.yaml; do [ -f "$HEDEF/asistanlar/$(basename "$f")" ] || cp "$f" "$HEDEF/asistanlar/"; done   # düzenlenmiş asistanların üzerine yazılmaz
[ -f "$HEDEF/numaralar.yaml" ] || cp "$BURASI/numaralar.yaml" "$HEDEF/"
cp "$BURASI/ai_ara.sh" "$BURASI/ses_analiz.sh" "$BURASI/guncelle.sh" "$BURASI/panel_sifre.sh" "$BURASI/disaridan_erisim.sh" "$BURASI/trunk_ekle.sh" "$BURASI/trunk_dene.sh" "$HEDEF/" 2>/dev/null || true
rm -rf "$HEDEF/asterisk" && cp -r "$BURASI/asterisk" "$HEDEF/"

LK_KEY=$(eski LIVEKIT_API_KEY);    LK_KEY=${LK_KEY:-API$(openssl rand -hex 6)}
LK_SECRET=$(eski LIVEKIT_API_SECRET); LK_SECRET=${LK_SECRET:-$(openssl rand -hex 24)}
API_ANAHTARI=$(eski API_ANAHTARI); API_ANAHTARI=${API_ANAHTARI:-xre_$(openssl rand -hex 20)}
PANEL_GIZLI=$(eski PANEL_GIZLI); PANEL_GIZLI=${PANEL_GIZLI:-$(openssl rand -hex 32)}
DEEPGRAM_URL_SATIRI=$(grep -E '^(DEEPGRAM_URL|SONIOX_API_KEY|TUNNEL_TOKEN)=' "$ENV" 2>/dev/null || true)
umask 077
cat > "$ENV" <<EOF
LIVEKIT_API_KEY=$LK_KEY
LIVEKIT_API_SECRET=$LK_SECRET
API_ANAHTARI=$API_ANAHTARI
OPENAI_API_KEY=$OPENAI_API_KEY
DEEPGRAM_API_KEY=$DEEPGRAM_API_KEY
ELEVEN_API_KEY=$ELEVEN_API_KEY
ELEVEN_VOICE_ID=$ELEVEN_VOICE_ID
ASTERISK_ADRES=127.0.0.1:$AST_PORT
ASTERISK_IPLERI=127.0.0.1,$LAN_IP
VARSAYILAN_GELEN_ASISTAN=test
PANEL_GIZLI=$PANEL_GIZLI
$DEEPGRAM_URL_SATIRI
EOF
cat > "$HEDEF/livekit.yaml" <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false
  node_ip: 127.0.0.1
redis:
  address: 127.0.0.1:6379
keys:
  $LK_KEY: $LK_SECRET
logging:
  level: info
EOF
cat > "$HEDEF/sip.yaml" <<EOF
api_key: $LK_KEY
api_secret: $LK_SECRET
ws_url: ws://127.0.0.1:7880
redis:
  address: 127.0.0.1:6379
sip_port: 5080
rtp_port: 21000-21200
use_external_ip: false
logging:
  level: info
EOF
umask 022
chmod 600 "$ENV" "$HEDEF/livekit.yaml" "$HEDEF/sip.yaml"

# ---------- 3) Asterisk: LiveKit köprüsü ----------
echo "== Asterisk ayarı güncelleniyor (NetGSM kaydına dokunulmaz) =="
cp -n "$PJSIP" "$PJSIP.ai-oncesi" || true
grep -q '^local_net=127.0.0.0/8' "$PJSIP" || sed -i "/^local_net=/a local_net=127.0.0.0/8" "$PJSIP"
if ! grep -q '^\[livekit\]' "$PJSIP"; then
cat >> "$PJSIP" <<EOF

; ---- LiveKit (aynı makinede, yalnızca yerel) ----
[livekit]
type=endpoint
transport=transport-udp
context=livekit-giden
disallow=all
allow=alaw,ulaw
aors=livekit-aor
direct_media=no
dtmf_mode=rfc4733

[livekit-aor]
type=aor
contact=sip:127.0.0.1:5080

[livekit-tani]
type=identify
endpoint=livekit
match=127.0.0.1
match=$LAN_IP
EOF
fi
GELEN_NUMARA=$(awk -F'"' '/numara:/{print $2; exit}' "$HEDEF/numaralar.yaml")
mkdir -p /var/spool/asterisk/kayit /var/spool/asterisk/test && chown asterisk:asterisk /var/spool/asterisk/kayit /var/spool/asterisk/test
cp -n /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.ai-oncesi || true
sed "s|__GELEN_NUMARA__|$GELEN_NUMARA|" "$BURASI/asterisk/extensions.conf" > /etc/asterisk/extensions.conf
systemctl restart asterisk

# ---------- 4) Güvenlik duvarı ve Docker ----------
ufw allow from "$LAN_NET" to any port 8080 proto tcp comment 'XRE arama API (yalnız ofis ağı)' >/dev/null
echo "== Docker imajları hazırlanıyor (ilk seferde 3-6 dakika sürer) =="
cd "$HEDEF"
docker compose up -d --build 2>&1 | tail -8

echo "== Servisler bekleniyor =="
for i in $(seq 1 40); do curl -s -m 2 http://127.0.0.1:8080/saglik | grep -q ok && break; sleep 3; done
sleep 8
echo
docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo
echo "NetGSM kaydı:"; asterisk -rx "pjsip show registrations" | grep -E "netgsm|Objects" || true
echo "Yapay zekâ ajanı:"; docker compose logs ajan 2>&1 | grep -c "registered worker" | sed 's/^0$/  ✗ henüz bağlanmadı (docker compose logs ajan)/; s/^[1-9].*$/  ✓ LiveKit'"'"'e bağlandı/'
echo
echo "KURULUM BİTTİ."
echo "  Deneme araması (yapay zekâ sizi arar):   sudo bash $HEDEF/ai_ara.sh 05XXXXXXXXX"
echo "  n8n için API adresi:  http://$LAN_IP:8080     anahtar: sudo grep API_ANAHTARI $ENV"
echo "  Yönetim paneli:       http://$LAN_IP:8080/panel"
ILK=$(docker compose logs api 2>&1 | grep -o "PANEL İLK GİRİŞ.*" | tail -1 || true)
[ -n "$ILK" ] && echo "  $ILK"
echo "  Panel şifresini sıfırlamak için:  sudo bash $HEDEF/panel_sifre.sh"

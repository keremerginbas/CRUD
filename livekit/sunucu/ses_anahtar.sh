#!/usr/bin/env bash
# Paneldeki "Ses karşılaştır" sayfası için seslendirme sağlayıcılarının anahtarlarını sunucuya ekler.
# Anahtarı yazarken ekranda görünmez; yalnızca bu sunucudaki .env dosyasına kaydedilir.
#   sudo bash /opt/xre-ai/ses_anahtar.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
HEDEF=${XRE_AI_KLASORU:-/opt/xre-ai}
ENV="$HEDEF/.env"
[ -f "$ENV" ] || { echo "Önce kurulum (kur_ai.sh) yapılmalı: $ENV bulunamadı."; exit 1; }
GECICI=$(mktemp "$HEDEF/.env.XXXXXX"); trap 'rm -f "$GECICI"' EXIT

eski() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- || true; }
durum() { [ -n "$(eski "$1")" ] && echo "kayıtlı" || echo "girilmemiş"; }
# yaz DEGISKEN değer — satır varsa değiştirir, yoksa ekler. Dosyanın izinleri ve sahibi aynı kalır;
# değer hiçbir komutun parametresi olmaz (işlem listesinde görünmez).
yaz() {
  { grep -vE "^$1=" "$ENV" || true; printf '%s=%s\n' "$1" "$2"; } > "$GECICI"
  cat "$GECICI" > "$ENV"; : > "$GECICI"
}
# anahtar_sor DEGISKEN "açıklama" — sonucu ANAHTAR değişkenine koyar; boş bırakılırsa kayıtlı olan korunur
anahtar_sor() {
  local mevcut v; mevcut=$(eski "$1")
  while :; do
    if [ -n "$mevcut" ]; then read -rsp "$2 [Enter = kayıtlı olanı koru]: " v || v=""; else read -rsp "$2: " v || v=""; fi
    echo
    v=$(printf '%s' "$v" | tr -d '[:space:]')
    if [ -z "$v" ] && [ -n "$mevcut" ]; then ANAHTAR=$mevcut; return 0; fi
    if [ -z "$v" ]; then echo "Anahtar girilmedi, bu sağlayıcı atlandı."; ANAHTAR=""; return 1; fi
    if [[ "$v" =~ ^[A-Za-z0-9._~+/=-]{16,}$ ]]; then ANAHTAR=$v; return 0; fi
    echo "Bu bir anahtara benzemiyor (${#v} karakter; en az 16 karakter olmalı, tırnak ya da özel işaret içermemeli). Yeniden yapıştırın."
  done
}

DEGISTI=0
while :; do
  echo
  echo "Hangi sağlayıcının anahtarını gireceksiniz?"
  echo "  1) Azure Speech   ($(durum AZURE_SPEECH_KEY))"
  echo "  2) Google Cloud   ($(durum GOOGLE_TTS_KEY))"
  echo "  3) Cartesia       ($(durum CARTESIA_API_KEY))"
  read -rp "Seçiminiz (1-3, bitirmek için Enter): " SECIM || SECIM=""
  case "$SECIM" in
    1)
      echo "Azure portalında: Speech kaynağınız → 'Keys and Endpoint' → KEY 1 ve Location/Region."
      if anahtar_sor AZURE_SPEECH_KEY "Azure Speech anahtarı (yazarken görünmez)"; then
        BOLGE_ESKI=$(eski AZURE_SPEECH_REGION); BOLGE_ESKI=${BOLGE_ESKI:-westeurope}
        read -rp "Azure bölgesi [$BOLGE_ESKI]: " BOLGE || BOLGE=""
        BOLGE=$(printf '%s' "${BOLGE:-$BOLGE_ESKI}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        if [[ "$BOLGE" =~ ^[a-z0-9]{3,30}$ ]]; then
          yaz AZURE_SPEECH_KEY "$ANAHTAR"; yaz AZURE_SPEECH_REGION "$BOLGE"; DEGISTI=1
          echo "✓ Azure anahtarı kaydedildi (bölge: $BOLGE)."
        else
          echo "✗ Bölge adı yalnızca harf ve rakam olmalı (ör. westeurope). Azure kaydedilmedi."
        fi
      fi ;;
    2)
      echo "Google Cloud'da: 'APIs & Services' → 'Credentials' → API key (Cloud Text-to-Speech API açık olmalı)."
      if anahtar_sor GOOGLE_TTS_KEY "Google Cloud API anahtarı (yazarken görünmez)"; then
        yaz GOOGLE_TTS_KEY "$ANAHTAR"; DEGISTI=1; echo "✓ Google anahtarı kaydedildi."
      fi ;;
    3)
      echo "Cartesia'da: play.cartesia.ai → 'API Keys'."
      if anahtar_sor CARTESIA_API_KEY "Cartesia API anahtarı (yazarken görünmez)"; then
        yaz CARTESIA_API_KEY "$ANAHTAR"; DEGISTI=1; echo "✓ Cartesia anahtarı kaydedildi."
        SES_ESKI=$(eski CARTESIA_SES_IDLERI)
        echo "Cartesia'da denemek istediğiniz seslerin kimliklerini ad=kimlik biçiminde, virgülle ayırarak yazın."
        echo "  Örnek: Selin=a0e99841-438c-4a64-b679-ae501e7d6091,Deniz=694f9389-aac1-45b6-b726-9d9369183238"
        [ -n "$SES_ESKI" ] && echo "  Kayıtlı: $SES_ESKI"
        read -rp "Sesler [Enter = $([ -n "$SES_ESKI" ] && echo 'kayıtlı olanı koru' || echo 'şimdilik boş bırak')]: " SESLER || SESLER=""
        SESLER=$(printf '%s' "$SESLER" | sed -E 's/[[:space:]]*([=,])[[:space:]]*/\1/g; s/^[[:space:]]+//; s/[[:space:]]+$//; s/,+$//')
        if [ -n "$SESLER" ]; then
          GECERLI=1; IFS=',' read -ra CIFTLER <<< "$SESLER"
          for C in "${CIFTLER[@]}"; do
            [[ "$C" =~ ^[^=,\$\#\"\'\\]{1,40}=[A-Za-z0-9_-]{8,64}$ ]] || { GECERLI=0; echo "✗ Anlaşılamadı: '$C' (beklenen: ad=kimlik)"; }
          done
          if [ "$GECERLI" = 1 ]; then yaz CARTESIA_SES_IDLERI "$SESLER"; echo "✓ ${#CIFTLER[@]} ses kaydedildi."
          else echo "Sesler kaydedilmedi; bu komutu yeniden çalıştırıp 3'ü seçerek düzeltebilirsiniz."; fi
        elif [ -z "$SES_ESKI" ]; then
          echo "Ses kimliği girilmedi: panelde Cartesia 'ses kimliği eklenmemiş' görünür. Sonra bu komutla ekleyebilirsiniz."
        fi
      fi ;;
    "") break ;;
    *) echo "1, 2 ya da 3 yazın." ;;
  esac
done

if [ "$DEGISTI" = 0 ]; then echo "Değişiklik yapılmadı."; exit 0; fi
echo
echo "== Panel yeniden başlatılıyor (anahtarlar yüklensin diye; birkaç saniye sürer) =="
cd "$HEDEF"
# Yalnızca paneli ve API'yi sunan kapsayıcı yenilenir; görüşmeleri yürüten yapay zekâ kapsayıcısına dokunulmaz.
docker compose up -d --no-deps --force-recreate api 2>&1 | tail -1
KOD=000
for _ in $(seq 1 30); do KOD=$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:8080/saglik || true); [ "$KOD" = 200 ] && break; sleep 2; done
if [ "$KOD" = 200 ]; then
  echo "✓ Panel hazır."
  echo
  echo "Şimdi: paneli açın → soldaki menüden 'Ses karşılaştır' → 'Hepsini üret'."
  echo "Bir ses hata verirse nedeni o satırın altında yazar; o yazıyı bize iletin."
else
  echo "✗ Panel 1 dakika içinde açılmadı. Şu komutun çıktısını gönderin: cd $HEDEF && docker compose logs --tail 30 api"
  exit 1
fi

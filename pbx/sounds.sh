#!/usr/bin/env bash
# Türkçe anonsları yapay sesle (Piper, çevrimdışı) üretip santrale koyar. Santral konteynerinde (CT 150):
#   /opt/santral/pbx/sounds.sh
# Metni değiştirmek için aşağıdaki satırları düzenleyip tekrar çalıştırın. Kendi kaydınızı kullanmak için
# aynı adla 8 kHz mono WAV dosyasını /var/lib/asterisk/sounds/custom/ altına koymanız yeterli.
set -euo pipefail
VOICE="${VOICE:-tr_TR-fahrettin-medium}"
TTS=/opt/xre-tts
OUT=/var/lib/asterisk/sounds/custom
export DEBIAN_FRONTEND=noninteractive

declare -A TEXT=(
  [xre-danismaniniz-ariyor]="Merhaba, XRE satış danışmanınız sizi arıyor. Görüşmeniz kalite standartları gereği kayıt altına alınmaktadır."
  [xre-danismaninizi-ariyorsunuz]="Satış danışmanınıza bağlanıyorsunuz. Görüşmeniz kalite standartları gereği kayıt altına alınmaktadır."
  [xre-kayit-bilgisi]="XRE'yi aradığınız için teşekkür ederiz. Görüşmeniz kalite standartları gereği kayıt altına alınmaktadır."
  [xre-musteriniz-ariyor]="Müşteriniz arıyor."
  [xre-musterinize-baglaniyorsunuz]="Müşterinize bağlanıyorsunuz."
)

if [[ ! -x $TTS/bin/python ]]; then
  echo "== Ses aracı kuruluyor"
  apt-get install -y -q python3-venv sox >/dev/null
  python3 -m venv "$TTS"
  "$TTS/bin/pip" install -q piper-tts
fi
command -v sox >/dev/null || apt-get install -y -q sox >/dev/null
[[ -f $TTS/$VOICE.onnx ]] || { echo "== Ses modeli indiriliyor: $VOICE"; "$TTS/bin/python" -m piper.download_voices --download-dir "$TTS" "$VOICE"; }

mkdir -p "$OUT"
for name in "${!TEXT[@]}"; do
  echo "${TEXT[$name]}" | "$TTS/bin/python" -m piper -m "$TTS/$VOICE.onnx" -f "/tmp/$name.wav" 2>/dev/null
  # Telefon hattı için 8 kHz, mono, 16 bit
  sox "/tmp/$name.wav" -r 8000 -c 1 -b 16 "$OUT/$name.wav"
  rm -f "/tmp/$name.wav"
  echo "hazır: $name.wav ($(soxi -D "$OUT/$name.wav" | cut -c1-4) sn)"
done
chown -R asterisk:asterisk "$OUT"

#!/usr/bin/env bash
# Kendi ekran kartımızda çalışan ses modelini (VoxCPM2) kurar ve başlatır. Şimdilik yalnızca DENEME içindir:
# paneldeki "Ses karşılaştır" sayfasında "Kendi sunucumuz" seçeneği açılır; canlı aramalar bundan etkilenmez.
#   Kurmak / yeniden başlatmak:  sudo bash /opt/xre-ai/ses_kur.sh
#   Durumuna bakmak:             sudo bash /opt/xre-ai/ses_kur.sh durum
#   Kapatmak (ekran kartını boşaltır; indirilen model silinmez):  sudo bash /opt/xre-ai/ses_kur.sh kapat
# İlk kurulum 20-40 dakika sürebilir (yaklaşık 12 GB indirilir). Arama yapılmayan bir saatte çalıştırın.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
HEDEF=${XRE_AI_KLASORU:-/opt/xre-ai}
ADRES=${SES_ADRES:-http://127.0.0.1:8090}
SURE_SN=${SES_SURE_SN:-1500}        # modelin hazır olması için en çok bekleme (25 dakika)
ARALIK_SN=${SES_ARALIK_SN:-5}
cd "$HEDEF" 2>/dev/null || { echo "Önce kurulum (kur_ai.sh) yapılmalı: $HEDEF bulunamadı."; exit 1; }
DC="docker compose --profile ses"

saglik() { curl -s -m 3 "$ADRES/saglik" 2>/dev/null || true; }
alan() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}[,}].*/\1/p"; }   # düz JSON'dan tek alan
kart_bellegi() { nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader 2>/dev/null | head -1 || true; }
gunluk_sonu() { $DC logs --tail "${1:-15}" ses 2>&1 | sed 's/^/    /' || true; }

case "${1:-}" in
  kapat)
    $DC stop ses 2>&1 | tail -1 || true
    $DC rm -f ses 2>&1 | tail -1 || true
    echo "Ses sunucusu kapatıldı, ekran kartı boşaldı. Panelde \"Kendi sunucumuz\" seçeneği kapalı görünür."
    echo "İndirilen model diskte duruyor (yeniden açınca tekrar inmez). Tamamen silmek için: docker volume rm xre-ai_ses-veri"
    exit 0 ;;
  durum)
    S=$(saglik)
    if [ -z "$S" ]; then echo "Ses sunucusu çalışmıyor. Başlatmak için: sudo bash $HEDEF/ses_kur.sh"
    elif printf '%s' "$S" | grep -q '"hazir":true'; then
      echo "✓ Ses sunucusu hazır (model $(alan "$S" yukleme_sn) saniyede yüklendi; hızlandırma: $(alan "$S" derleme))."
    elif printf '%s' "$S" | grep -q '"durum":"hata"'; then echo "✗ Model yüklenemedi: $(alan "$S" hata)"
    else echo "… Model hazırlanıyor: $(alan "$S" asama) ($(alan "$S" yukleme_sn) saniyedir)"; fi
    K=$(kart_bellegi); [ -n "$K" ] && echo "Ekran kartı (ad, kullanılan, toplam bellek): $K" || echo "Ekran kartı bilgisi alınamadı (nvidia-smi çalışmıyor)."
    exit 0 ;;
  "") ;;
  *) echo "Kullanım: sudo bash $HEDEF/ses_kur.sh [durum|kapat]"; exit 1 ;;
esac

[ -f "$HEDEF/ses/Dockerfile" ] && grep -q '^  ses:' "$HEDEF/docker-compose.yml" || { echo "Ses sunucusunun dosyaları yok. Önce güncelleyin: sudo bash $HEDEF/guncelle.sh"; exit 1; }

echo "== 1/4 Ekran kartı denetleniyor =="
command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1 || { echo "✗ Ekran kartı sürücüsü çalışmıyor (nvidia-smi komutu hata verdi). Önce NVIDIA sürücüsü kurulmalı."; exit 1; }
echo "  Kart: $(kart_bellegi)"
TOPLAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -dc 0-9 || true)
[ "${TOPLAM_MB:-0}" -ge 7500 ] || echo "  ! Uyarı: model yaklaşık 8 GB kart belleği ister; bu kartta ${TOPLAM_MB:-?} MB var, sığmayabilir."
if ! docker run --rm --gpus all python:3.12-slim-bookworm nvidia-smi >/dev/null 2>&1; then
  echo "✗ Docker ekran kartını göremiyor. Şunlar gerekli (bir kez):"
  echo "    sudo apt-get install -y nvidia-container-toolkit"
  echo "    sudo nvidia-ctk runtime configure --runtime=docker"
  echo "    sudo systemctl restart docker     ← DİKKAT: bu komut süren aramaları keser; arama olmayan bir saatte çalıştırın"
  echo "  Sonra bu betiği yeniden çalıştırın."
  exit 1
fi
echo "  ✓ Docker ekran kartını görüyor."

echo "== 2/4 Disk ve bellek denetleniyor =="
KOK=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true); [ -d "${KOK:-}" ] || KOK=/var/lib/docker
BOS_GB=$(df -BG --output=avail "$KOK" 2>/dev/null | tail -1 | tr -dc 0-9 || true)
# Model daha önce indirildiyse (birim duruyorsa) yeniden indirilmez: daha az yer yeter
if docker volume inspect xre-ai_ses-veri >/dev/null 2>&1 && docker image inspect xre-ai-ses >/dev/null 2>&1; then GEREK_GB=8; else GEREK_GB=20; fi
[ "${BOS_GB:-0}" -ge "$GEREK_GB" ] || { echo "✗ Diskte yer az: ${BOS_GB:-?} GB boş, en az $GEREK_GB GB gerekli (program yaklaşık 8 GB, model 5 GB)."; exit 1; }
echo "  ✓ Disk: ${BOS_GB} GB boş."
RAM_MB=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo 2>/dev/null || true)
[ "${RAM_MB:-9999}" -ge 3500 ] || echo "  ! Uyarı: boş sistem belleği az (${RAM_MB} MB). Model yüklenirken 2-3,5 GB kullanır; yüklenemezse arama yokken yeniden deneyin."
if ! $DC ps --status running --services 2>/dev/null | grep -qx ses; then
  KAPI=${ADRES##*:}
  if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":$KAPI "; then echo "✗ $KAPI numaralı kapıyı başka bir program kullanıyor; ses sunucusu açılamaz."; exit 1; fi
fi

echo "== 3/4 Program hazırlanıyor (ilk seferde 10-20 dakika, yaklaşık 4 GB indirilir) =="
INSA=$(mktemp); trap 'rm -f "$INSA"' EXIT
$DC build ses > "$INSA" 2>&1 &
PID=$!; BAS=$(date +%s)
while kill -0 "$PID" 2>/dev/null; do
  sleep "$ARALIK_SN"
  printf '  [%d dk] %s\n' $(( ($(date +%s) - BAS) / 60 )) "$(tail -1 "$INSA" | tr -d '\r' | cut -c1-90)"
done
wait "$PID" || { echo "✗ Program hazırlanamadı. Son satırlar:"; tail -15 "$INSA" | sed 's/^/    /'; exit 1; }
$DC up -d ses 2>&1 | tail -2

echo "== 4/4 Model indiriliyor ve ekran kartına yükleniyor (ilk seferde 10-25 dakika, yaklaşık 5 GB) =="
BAS=$(date +%s); ONCEKI=""; SONUC=bekliyor
while [ $(( $(date +%s) - BAS )) -lt "$SURE_SN" ]; do
  S=$(saglik)
  if printf '%s' "$S" | grep -q '"hazir":true'; then SONUC=hazir; break; fi
  if printf '%s' "$S" | grep -q '"durum":"hata"'; then SONUC=hata; break; fi
  # Kapsayıcı çöküp yeniden başlıyorsa (çoğunlukla bellek yetmezliği) beklemenin anlamı yok
  D=$(docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}} {{.State.Status}}' "$($DC ps -aq ses 2>/dev/null | head -1)" 2>/dev/null || true)
  case "$D" in true*) SONUC=bellek; break ;; esac
  set -- $D; if [ "${2:-0}" -ge 2 ] 2>/dev/null; then SONUC=cokuyor; break; fi
  SATIR="$(alan "$S" asama)"; MB=$(alan "$S" indirilen_mb)
  [ -n "$MB" ] && [ "$MB" != null ] && [ "$MB" -gt 0 ] 2>/dev/null && SATIR="$SATIR — $MB MB indi"
  [ -n "$SATIR" ] || SATIR="Sunucu açılıyor"
  GECEN=$(( ($(date +%s) - BAS) / 60 ))
  if [ "$SATIR|$GECEN" != "$ONCEKI" ]; then printf '  [%d dk] %s\n' "$GECEN" "$SATIR"; ONCEKI="$SATIR|$GECEN"; fi
  sleep "$ARALIK_SN"
done

echo
case "$SONUC" in
  hazir)
    echo "✓ Ses sunucusu hazır. Model $(alan "$S" yukleme_sn) saniyede yüklendi; hızlandırma (derleme): $(alan "$S" derleme)."
    echo "  Ekran kartı (ad, kullanılan, toplam bellek): $(kart_bellegi)"
    echo
    echo "Şimdi ne yapmalı?"
    echo "  1) Paneli açın → \"Ses karşılaştır\" sayfası → \"Kendi sunucumuz (VoxCPM2)\" kartı \"Hazır\" görünmeli."
    echo "  2) \"Üret\"e basın; sesi dinleyin ve altındaki ölçüme bakın: \"Hız\" 1'den küçükse model canlı konuşmaya yetişir."
    echo "  3) Aynı cümleyi ElevenLabs ile de üretip yan yana dinleyin."
    echo "  İşiniz bitince ekran kartını boşaltmak için: sudo bash $HEDEF/ses_kur.sh kapat"
    exit 0 ;;
  hata)
    echo "✗ Model yüklenemedi: $(alan "$S" hata)"
    echo "  Ekran kartı (ad, kullanılan, toplam bellek): $(kart_bellegi)"
    echo "  Kart belleği yetmediyse (\"out of memory\"): hızlandırmayı kapatıp yeniden deneyin:"
    echo "      echo SES_DERLE=0 | sudo tee -a $HEDEF/.env && sudo bash $HEDEF/ses_kur.sh"
    echo "  Son kayıtlar:"; gunluk_sonu 15
    echo "  Ekran kartını boşaltmak için: sudo bash $HEDEF/ses_kur.sh kapat"
    exit 1 ;;
  bellek|cokuyor)
    echo "✗ Ses sunucusu açılırken duruyor$([ "$SONUC" = bellek ] && echo ' (sistem belleği yetmedi)')."
    echo "  Canlı aramalar etkilenmesin diye kapatıldı. Son kayıtlar:"; gunluk_sonu 15
    $DC stop ses >/dev/null 2>&1 || true
    exit 1 ;;
  *)
    echo "… $(( SURE_SN / 60 )) dakika doldu, model hâlâ hazır değil (son durum: $(alan "$S" asama))."
    echo "  İnternet yavaşsa indirme sürüyor olabilir; arka planda devam ediyor. Durumuna bakmak için:"
    echo "      sudo bash $HEDEF/ses_kur.sh durum"
    echo "  Vazgeçmek için: sudo bash $HEDEF/ses_kur.sh kapat"
    exit 1 ;;
esac

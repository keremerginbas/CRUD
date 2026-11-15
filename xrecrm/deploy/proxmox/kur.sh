#!/usr/bin/env bash
# XRE CRM — kendi sunucunuzda (Proxmox konteyneri / sanal makine) tek firma için kurulum.
# HTTPS bu makinede sonlanmaz: önündeki ara sunucu (Hestia/nginx) sertifikayı taşır ve
# istekleri bu makinenin 3000 numaralı kapısına yönlendirir.
#
# Kullanım (root olarak, temiz bir Debian 12 / Ubuntu 22.04+ makinede):
#   İlk kurulum : bash kur.sh crm.firma.com.tr "Firma Adı"
#   Güncelleme  : bash /opt/xre/xrecrm/deploy/proxmox/kur.sh --guncelle
#   Yedek al    : bash /opt/xre/xrecrm/deploy/proxmox/kur.sh --yedek
#   Durum       : bash /opt/xre/xrecrm/deploy/proxmox/kur.sh --durum
set -euo pipefail

REPO_URL="https://github.com/keremerginbas/CRUD.git"
BRANCH="${XRE_BRANCH:-claude/wizardly-hawking-u26qk6}"
SRC=/opt/xre
DATA=/opt/xre-veri
BACKUPS=/opt/xre-yedek
ENVFILE=/opt/xre-ayar.env
NAME=xrecrm
PORT="${XRE_PORT:-3000}"
KEEP_DAYS=14

[ "$(id -u)" -eq 0 ] || { echo "Lütfen root olarak çalıştırın."; exit 1; }

yedek() {
  mkdir -p "$BACKUPS"
  local file="$BACKUPS/xrecrm-$(date +%Y%m%d-%H%M%S).tar.gz"
  # Veri klasörü: veritabanı dosyası + proje görselleri + yüklenen dosyalar.
  tar -czf "$file" -C "$(dirname "$DATA")" "$(basename "$DATA")"
  chmod 600 "$file"
  find "$BACKUPS" -name 'xrecrm-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  echo "Yedek alındı: $file ($(du -h "$file" | cut -f1))"
}

calistir() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --restart always \
    --env-file "$ENVFILE" \
    -e NODE_ENV=production -e PORT=3000 -e XRE_DATA_DIR=/app/data -e XRE_APP_MODE=crm -e XRE_TRUST_PROXY=1 \
    -v "$DATA":/app/data \
    -p "$PORT":3000 \
    "$NAME:latest" >/dev/null
}

bekle() {
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

case "${1:-}" in
  --yedek) yedek; exit 0 ;;
  --durum)
    docker ps --filter "name=^${NAME}$" --format 'Konteyner: {{.Names}}  {{.Status}}'
    curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && echo "Sunucu yanıt veriyor (kapı $PORT)." || echo "Sunucu YANIT VERMİYOR. Kayıtlar: docker logs --tail 50 $NAME"
    ls -1t "$BACKUPS" 2>/dev/null | head -3 | sed 's/^/Son yedek: /' || true
    exit 0 ;;
  --guncelle)
    [ -d "$SRC/.git" ] || { echo "Kurulum bulunamadı ($SRC). Önce ilk kurulumu yapın."; exit 1; }
    echo "1/4 Güncellemeden önce yedek alınıyor..."; yedek
    echo "2/4 Yeni sürüm indiriliyor..."; git -C "$SRC" fetch --depth 1 origin "$BRANCH" && git -C "$SRC" reset --hard FETCH_HEAD
    echo "3/4 Hazırlanıyor (birkaç dakika sürebilir)..."
    docker tag "$NAME:latest" "$NAME:onceki" 2>/dev/null || true
    docker build -q -t "$NAME:latest" "$SRC/xrecrm" >/dev/null
    echo "4/4 Yeniden başlatılıyor..."; calistir
    if bekle; then echo "== Güncelleme tamam =="; docker image prune -f >/dev/null 2>&1 || true
    else
      echo "HATA: yeni sürüm açılmadı; önceki sürüme dönülüyor."
      docker tag "$NAME:onceki" "$NAME:latest" && calistir && bekle && echo "Önceki sürüm çalışıyor. Kayıtlar: docker logs --tail 80 $NAME"
      exit 1
    fi
    exit 0 ;;
esac

DOMAIN="${1:-}"
if ! printf '%s' "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'; then
  echo "Kullanım: bash kur.sh <alan-adı>     örnek: bash kur.sh trinvest.xresoftware.com.tr"; exit 1
fi

echo "== XRE CRM kurulumu: $DOMAIN =="
echo "1/6 Gerekli programlar kuruluyor..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl cron >/dev/null
if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || {
  echo "HATA: Docker çalışmıyor. Proxmox konteynerinde (LXC) iseniz Proxmox'ta bu konteyner için"
  echo "Seçenekler → Özellikler → 'nesting' (iç içe) kutusunu işaretleyip konteyneri yeniden başlatın."
  exit 1
}

echo "2/6 Program dosyaları indiriliyor..."
if [ -d "$SRC/.git" ]; then git -C "$SRC" fetch --depth 1 origin "$BRANCH" && git -C "$SRC" reset --hard FETCH_HEAD
else git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC"; fi

echo "3/6 Ayarlar yazılıyor..."
mkdir -p "$DATA" "$BACKUPS"
# Konteyner içindeki kullanıcı veri klasörüne yazabilsin.
chmod 700 "$BACKUPS"
if [ ! -f "$ENVFILE" ]; then
  umask 077
  {
    echo "PUBLIC_ORIGIN=https://$DOMAIN"
    echo "XRE_SESSION_SECRET=$(openssl rand -hex 48)"
    if [ -n "${2:-}" ]; then echo "XRE_BRAND_NAME=$2"; fi
  } > "$ENVFILE"
else
  sed -i "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://$DOMAIN|" "$ENVFILE"
fi
chmod 600 "$ENVFILE"

echo "4/6 Program hazırlanıyor (ilk seferde 5-10 dakika sürebilir)..."
docker build -q -t "$NAME:latest" "$SRC/xrecrm" >/dev/null

echo "5/6 Başlatılıyor..."
calistir
bekle || { echo "HATA: sunucu açılmadı. Kayıtlar:"; docker logs --tail 60 "$NAME"; exit 1; }

echo "6/6 Günlük yedek ayarlanıyor (her gece 03:30, son $KEEP_DAYS gün saklanır)..."
cat > /etc/cron.d/xrecrm-yedek <<CRON
30 3 * * * root bash $SRC/xrecrm/deploy/proxmox/kur.sh --yedek >> /var/log/xrecrm-yedek.log 2>&1
CRON
chmod 644 /etc/cron.d/xrecrm-yedek
systemctl enable --now cron >/dev/null 2>&1 || true

IP=$(hostname -I | awk '{print $1}')
echo
echo "== Kurulum tamam =="
echo "Bu makinede CRM şu adreste çalışıyor:  http://$IP:$PORT"
echo "Ara sunucuda (Hestia) $DOMAIN isteklerini bu adrese yönlendirin."
echo "Sonra https://$DOMAIN adresini açıp İLK HESABI HEMEN oluşturun (ilk hesap yönetici olur)."
echo "Güncelleme:  bash $SRC/xrecrm/deploy/proxmox/kur.sh --guncelle"
echo "Yedekler:    $BACKUPS"

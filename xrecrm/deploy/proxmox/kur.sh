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
#   WhatsApp aç : bash /opt/xre/xrecrm/deploy/proxmox/kur.sh --whatsapp
set -euo pipefail

REPO_URL="https://github.com/keremerginbas/CRUD.git"
BRANCH="${XRE_BRANCH:-claude/wizardly-hawking-u26qk6}"
SRC=/opt/xre
DATA=/opt/xre-veri
BACKUPS=/opt/xre-yedek
ENVFILE=/opt/xre-ayar.env
NAME=xrecrm
DB_NAME=xrecrm-db
NET=xrecrm-net
PORT="${XRE_PORT:-3000}"
KEEP_DAYS=14

[ "$(id -u)" -eq 0 ] || { echo "Lütfen root olarak çalıştırın."; exit 1; }

# PostgreSQL (16 Kasım 2026): veriler xrecrm-db konteynerindeki veritabanında; dışarıya kapı açılmaz.
veritabani() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  if ! grep -q '^DATABASE_URL=' "$ENVFILE" 2>/dev/null; then
    local pw; pw=$(openssl rand -hex 24)
    umask 077
    echo "XRE_DB_PASSWORD=$pw" >> "$ENVFILE"
    echo "DATABASE_URL=postgres://xrecrm:$pw@$DB_NAME:5432/xrecrm" >> "$ENVFILE"
  fi
  if ! docker ps -a --format '{{.Names}}' | grep -qx "$DB_NAME"; then
    local pw; pw=$(grep '^XRE_DB_PASSWORD=' "$ENVFILE" | cut -d= -f2-)
    docker run -d --name "$DB_NAME" --restart always --network "$NET" --memory 1g \
      -e POSTGRES_USER=xrecrm -e POSTGRES_DB=xrecrm -e POSTGRES_PASSWORD="$pw" \
      -v xrecrm_db:/var/lib/postgresql/data \
      --health-cmd "pg_isready -U xrecrm -d xrecrm" --health-interval 5s --health-retries 20 \
      postgres:16-alpine >/dev/null
  fi
  docker start "$DB_NAME" >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$DB_NAME" 2>/dev/null)" = healthy ] && return 0
    sleep 2
  done
  echo "HATA: veritabanı açılmadı. Kayıtlar: docker logs --tail 50 $DB_NAME"; return 1
}

# WhatsApp (QR ile bağlanan hat): Evolution API + Redis. "kur.sh --whatsapp" ile bir kez açılır,
# sonraki güncellemelerde kendiliğinden yeniden başlar. Dışarıya kapı açılmaz; yalnız CRM konuşur.
WA_NAME=xrecrm-evolution
WA_REDIS=xrecrm-redis
WA_IMAGE=evoapicloud/evolution-api:v2.3.7
whatsapp_acik() { grep -q '^EVOLUTION_API_KEY=' "$ENVFILE" 2>/dev/null; }
whatsapp() {
  whatsapp_acik || return 0
  local pw key
  pw=$(grep '^XRE_DB_PASSWORD=' "$ENVFILE" | cut -d= -f2-)
  key=$(grep '^EVOLUTION_API_KEY=' "$ENVFILE" | cut -d= -f2-)
  # WhatsApp oturumları CRM veritabanından ayrı bir veritabanında durur (aynı PostgreSQL).
  docker exec "$DB_NAME" psql -U xrecrm -d xrecrm -tAc "SELECT 1 FROM pg_database WHERE datname='evolution'" | grep -q 1 \
    || docker exec "$DB_NAME" psql -U xrecrm -d xrecrm -c "CREATE DATABASE evolution" >/dev/null
  if ! docker ps -a --format '{{.Names}}' | grep -qx "$WA_REDIS"; then
    docker run -d --name "$WA_REDIS" --restart always --network "$NET" --memory 256m \
      -v xrecrm_redis:/data redis:7-alpine >/dev/null
  fi
  docker start "$WA_REDIS" >/dev/null 2>&1 || true
  if ! docker ps -a --format '{{.Names}}' | grep -qx "$WA_NAME"; then
    docker run -d --name "$WA_NAME" --restart always --network "$NET" --memory 1g \
      -e SERVER_URL="http://$WA_NAME:8080" -e AUTHENTICATION_API_KEY="$key" \
      -e DATABASE_ENABLED=true -e DATABASE_PROVIDER=postgresql \
      -e DATABASE_CONNECTION_URI="postgresql://xrecrm:$pw@$DB_NAME:5432/evolution" \
      -e DATABASE_SAVE_DATA_INSTANCE=true -e DATABASE_SAVE_DATA_NEW_MESSAGE=false \
      -e CACHE_REDIS_ENABLED=true -e CACHE_REDIS_URI="redis://$WA_REDIS:6379/6" -e CACHE_LOCAL_ENABLED=false \
      -e CONFIG_SESSION_PHONE_CLIENT="${XRE_WA_CLIENT_NAME:-CRM}" -e CONFIG_SESSION_PHONE_NAME=Chrome -e LANGUAGE=tr \
      -v xrecrm_evolution:/evolution/instances \
      "$WA_IMAGE" >/dev/null
  fi
  docker start "$WA_NAME" >/dev/null 2>&1 || true
}
whatsapp_kur() {
  [ -f "$ENVFILE" ] || { echo "Kurulum bulunamadı. Önce ilk kurulumu yapın."; exit 1; }
  if ! whatsapp_acik; then
    umask 077
    {
      echo "EVOLUTION_API_KEY=$(openssl rand -hex 24)"
      echo "EVOLUTION_WEBHOOK_SECRET=$(openssl rand -hex 24)"
      echo "EVOLUTION_API_URL=http://$WA_NAME:8080"
      echo "EVOLUTION_WEBHOOK_URL=http://$NAME:3000/api/webhooks/evolution"
      echo "OUTBOUND_ALLOW_PRIVATE_HOSTS=$WA_NAME"
    } >> "$ENVFILE"
  fi
  echo "1/3 WhatsApp sunucusu indiriliyor (ilk seferde birkaç dakika sürebilir)..."
  docker pull -q "$WA_IMAGE" >/dev/null
  docker pull -q redis:7-alpine >/dev/null
  echo "2/3 Başlatılıyor..."
  calistir
  echo "3/3 Kontrol ediliyor..."
  bekle || { echo "HATA: CRM açılmadı. Kayıtlar: docker logs --tail 60 $NAME"; exit 1; }
  local ok=0
  for _ in $(seq 1 45); do
    if docker exec "$NAME" node -e "fetch('http://$WA_NAME:8080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" = 1 ]; then
    echo "== WhatsApp hazır =="
    echo "CRM'de WhatsApp sayfasını açıp 'Hat ekle' ile QR kodu telefondan okutun."
  else
    echo "HATA: WhatsApp sunucusu açılmadı. Kayıtlar: docker logs --tail 60 $WA_NAME"; exit 1
  fi
}

yedek() {
  mkdir -p "$BACKUPS"
  # Veritabanı dökümü (geri yükleme: gunzip -c dosya | docker exec -i xrecrm-db psql -U xrecrm -d xrecrm)
  if docker ps --format '{{.Names}}' | grep -qx "$DB_NAME"; then
    local dump="$BACKUPS/xrecrm-db-$(date +%Y%m%d-%H%M%S).sql.gz"
    docker exec "$DB_NAME" pg_dump -U xrecrm -d xrecrm --clean --if-exists | gzip > "$dump"
    chmod 600 "$dump"
    find "$BACKUPS" -name 'xrecrm-db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
    echo "Veritabanı yedeği: $dump ($(du -h "$dump" | cut -f1))"
  fi
  local file="$BACKUPS/xrecrm-$(date +%Y%m%d-%H%M%S).tar.gz"
  # Veri klasörü: veritabanı dosyası + proje görselleri + yüklenen dosyalar.
  tar -czf "$file" -C "$(dirname "$DATA")" "$(basename "$DATA")"
  chmod 600 "$file"
  find "$BACKUPS" -name 'xrecrm-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  echo "Yedek alındı: $file ($(du -h "$file" | cut -f1))"
}

calistir() {
  veritabani
  whatsapp
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # Bellek sınırı: aşırı yükte bütün makine değil yalnız CRM yeniden başlar.
  docker run -d --name "$NAME" --restart always --network "$NET" --memory 2g \
    --env-file "$ENVFILE" \
    -e NODE_ENV=production -e PORT=3000 -e XRE_DATA_DIR=/app/data -e XRE_APP_MODE=crm -e XRE_TRUST_PROXY=1 \
    -e NODE_OPTIONS=--max-old-space-size=1536 \
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
  --whatsapp) whatsapp_kur; exit 0 ;;
  --durum)
    docker ps --filter "name=^${NAME}$" --format 'Konteyner: {{.Names}}  {{.Status}}'
    if whatsapp_acik; then docker ps --filter "name=^${WA_NAME}$" --format 'WhatsApp:  {{.Names}}  {{.Status}}'; fi
    curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && echo "Sunucu yanıt veriyor (kapı $PORT)." || echo "Sunucu YANIT VERMİYOR. Kayıtlar: docker logs --tail 50 $NAME"
    ls -1t "$BACKUPS" 2>/dev/null | head -3 | sed 's/^/Son yedek: /' || true
    exit 0 ;;
  --guncelle)
    [ -d "$SRC/.git" ] || { echo "Kurulum bulunamadı ($SRC). Önce ilk kurulumu yapın."; exit 1; }
    echo "1/4 Güncellemeden önce yedek alınıyor..."; yedek
    echo "2/4 Yeni sürüm indiriliyor..."
    git -C "$SRC" fetch origin "$BRANCH"
    # Bu makinede GitHub'a gönderilmemiş değişiklik varsa (ör. PostgreSQL desteği) üzerine yazılmaz.
    if [ -n "$(git -C "$SRC" log --oneline FETCH_HEAD..HEAD 2>/dev/null)" ]; then
      echo "DUR: bu makinede GitHub'da olmayan değişiklikler var:"; git -C "$SRC" log --oneline FETCH_HEAD..HEAD | head -10
      echo "Önce bu değişiklikleri GitHub'daki dala gönderin; güncelleme yapılmadı."; exit 1
    fi
    git -C "$SRC" reset --hard FETCH_HEAD
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

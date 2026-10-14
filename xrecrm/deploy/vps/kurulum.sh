#!/usr/bin/env bash
# XRE CRM — Ubuntu 22.04/24.04 VPS tek komut kurulum / güncelleme
#   Önce alan adınızın (ör. crm.xresoftware.com.tr) A kaydını bu sunucunun IP adresine yönlendirin.
#   Sonra:  sudo bash xrecrm/deploy/vps/kurulum.sh
# Sunucuda zaten Caddy çalışıyorsa (ör. n8n için) ona dokunmadan CRM'i ekler.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -p xrecrm"

if [ "$(id -u)" -ne 0 ]; then echo "Lütfen sudo ile çalıştırın: sudo bash kurulum.sh"; exit 1; fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker kuruluyor..."
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  read -rp "CRM alan adı (ör. crm.xresoftware.com.tr): " CRM_DOMAIN
  read -rp "SSL sertifikası için e-posta: " ACME_EMAIL
  rand() { openssl rand -hex 24; }
  cat > .env <<ENV
CRM_DOMAIN=${CRM_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
XRE_SESSION_SECRET=$(rand)$(rand)
EVOLUTION_API_KEY=$(rand)
EVOLUTION_WEBHOOK_SECRET=$(rand)
POSTGRES_PASSWORD=$(rand)
ENV
  chmod 600 .env
  echo ".env oluşturuldu (gizli anahtarlar otomatik üretildi)."
fi
set -a; . ./.env; set +a

# Alan adı bu sunucuyu gösteriyor mu?
PUBLIC_IP=$(curl -fsS4 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$CRM_DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -n "$PUBLIC_IP" ] && [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  echo "UYARI: $CRM_DOMAIN şu an '${DNS_IP:-yok}' adresini gösteriyor, bu sunucu $PUBLIC_IP."
  echo "       cPanel > Zone Editor'dan A kaydını $PUBLIC_IP yapın. HTTPS sertifikası kayıt yayılınca kendiliğinden alınır."
fi

# Mevcut Caddy var mı?
EXISTING_CADDY=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:443->/{print $1; exit}')
if [ -n "$EXISTING_CADDY" ] && docker exec "$EXISTING_CADDY" caddy version >/dev/null 2>&1; then
  echo "Mevcut Caddy bulundu: $EXISTING_CADDY (n8n vb. dokunulmayacak)."
  PROXY_NETWORK=$(docker inspect "$EXISTING_CADDY" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
  CADDYFILE=$(docker inspect "$EXISTING_CADDY" -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
  if [ -z "$CADDYFILE" ]; then
    DIR=$(docker inspect "$EXISTING_CADDY" -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}')
    [ -n "$DIR" ] && CADDYFILE="$DIR/Caddyfile"
  fi
  export PROXY_NETWORK
  grep -q '^PROXY_NETWORK=' .env && sed -i "s/^PROXY_NETWORK=.*/PROXY_NETWORK=$PROXY_NETWORK/" .env || echo "PROXY_NETWORK=$PROXY_NETWORK" >> .env
  $COMPOSE up -d --build
  if [ -n "$CADDYFILE" ] && [ -f "$CADDYFILE" ]; then
    if grep -q "^$CRM_DOMAIN " "$CADDYFILE"; then
      echo "Caddy'de $CRM_DOMAIN zaten tanımlı."
    else
      BACKUP="$CADDYFILE.yedek-$(date +%Y%m%d-%H%M%S)"
      cp "$CADDYFILE" "$BACKUP"
      printf '\n# XRE CRM\n%s {\n\tencode gzip\n\treverse_proxy xrecrm-crm:3000\n}\n' "$CRM_DOMAIN" >> "$CADDYFILE"
      if docker exec "$EXISTING_CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
        docker exec "$EXISTING_CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
        echo "Caddy'ye $CRM_DOMAIN eklendi (yedek: $BACKUP)."
      else
        cat "$BACKUP" > "$CADDYFILE"
        echo "HATA: Caddy yeni ayarı kabul etmedi, eski hali geri yüklendi. Aşağıdaki bloğu elle ekleyin:"
        printf '%s {\n\treverse_proxy xrecrm-crm:3000\n}\n' "$CRM_DOMAIN"
        exit 1
      fi
    fi
  else
    echo "Caddy ayar dosyası bulunamadı. Mevcut Caddyfile'a şu bloğu ekleyip Caddy'yi yeniden yükleyin:"
    printf '%s {\n\treverse_proxy xrecrm-crm:3000\n}\n' "$CRM_DOMAIN"
  fi
else
  export PROXY_NETWORK=xrecrm_proxy
  grep -q '^PROXY_NETWORK=' .env || echo "PROXY_NETWORK=xrecrm_proxy" >> .env
  docker network inspect xrecrm_proxy >/dev/null 2>&1 || docker network create xrecrm_proxy >/dev/null
  if command -v ufw >/dev/null 2>&1; then
    ufw allow OpenSSH >/dev/null || true
    ufw allow 80/tcp >/dev/null || true
    ufw allow 443/tcp >/dev/null || true
  fi
  $COMPOSE --profile kendi-caddy up -d --build
fi

echo
echo "Kurulum tamamlandı: https://${CRM_DOMAIN}  (ilk açılışta yönetici hesabını oluşturun)"
echo "WhatsApp: CRM > WhatsApp > Bağlantılar > hattın QR'ını telefonla okutun."
echo "Durum:   docker compose -p xrecrm ps      Kayıtlar: docker logs -f xrecrm-crm"
echo "Güncelleme: yeni ZIP'i aynı klasöre açıp tekrar: sudo bash kurulum.sh"

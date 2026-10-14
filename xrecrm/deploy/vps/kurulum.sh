#!/usr/bin/env bash
# XRE CRM — Ubuntu 22.04/24.04 VPS tek komut kurulum
#   1) Alan adınızın (ör. crm.xresoftware.com.tr) A kaydını bu sunucunun IP adresine yönlendirin.
#   2) ZIP'i sunucuya yükleyip açın, sonra:  sudo bash xrecrm/deploy/vps/kurulum.sh
set -euo pipefail
cd "$(dirname "$0")"

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

# Güvenlik duvarı: yalnız SSH, HTTP, HTTPS
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null || true
  ufw allow 80/tcp >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  ufw --force enable >/dev/null || true
fi

docker compose up -d --build
set -a; . ./.env; set +a
echo
echo "Kurulum tamamlandı. Birkaç dakika içinde açılır: https://${CRM_DOMAIN}"
echo "İlk açılışta yönetici hesabını oluşturun."
echo "WhatsApp: CRM > WhatsApp > Bağlantılar > hattın QR'ını telefonla okutun (Evolution hazır bağlı gelir)."
echo "Güncelleme: yeni ZIP'i aynı klasöre açıp tekrar: sudo bash kurulum.sh"
echo "Kayıtlar:   docker compose logs -f crm"

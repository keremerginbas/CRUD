#!/usr/bin/env bash
# XRE CRM deneme kurulumu: yeni özellikler (çalışma alanları, ücretsiz kayıt) canlıya
# alınmadan önce ayrı bir adreste (ör. test.crm.xresoftware.com.tr) denenir.
#   - ayrı konteyner (xrecrm-test) ve ayrı veri; canlı CRM'e ve WhatsApp'a dokunmaz
#   - ücretsiz kayıt açıktır (XRE_SIGNUP=1)
#
# Önce DNS: deneme alan adının A kaydını bu sunucunun IP adresine yönlendirin.
# Kullanım:  sudo bash xrecrm/deploy/vps/deneme-kur.sh [alan-adı]
# Kaldırma:  sudo bash xrecrm/deploy/vps/deneme-kur.sh --kaldir
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -p xrecrm --profile test"
if [ "$(id -u)" -ne 0 ]; then echo "Lütfen sudo ile çalıştırın."; exit 1; fi
[ -f .env ] || { echo ".env yok: önce kurulum.sh ile CRM'i kurun."; exit 1; }
set -a; . ./.env; set +a

setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; export "$1=$2"; }

CADDY=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:443->/{print $1; exit}')
CADDYFILE=""
if [ -n "$CADDY" ]; then
  CADDYFILE=$(docker inspect "$CADDY" -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
  if [ -z "$CADDYFILE" ]; then
    DIR=$(docker inspect "$CADDY" -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}')
    [ -n "$DIR" ] && CADDYFILE="$DIR/Caddyfile"
  fi
fi
caddy_reload() {
  docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 &&
    docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

if [ "${1:-}" = "--kaldir" ]; then
  docker rm -f xrecrm-test >/dev/null 2>&1 || true
  sed -i '/^TEST_DOMAIN=/d' .env
  echo "Deneme kurulumu durduruldu. Verisi (xrecrm_test_data) duruyor; tamamen silmek için:"
  echo "  docker volume rm xrecrm_test_data"
  echo "Caddy ayarındaki '${TEST_DOMAIN:-deneme}' bloğunu isterseniz elle silebilirsiniz; zararı yoktur."
  exit 0
fi

echo "== XRE CRM deneme kurulumu =="
DEFAULT_TEST="test.${CRM_DOMAIN}"
# Alan adı komutla verilebilir (soru sorulmaz): deneme-kur.sh test.crm.ornek.com
INPUT=${1:-}
[ -n "$INPUT" ] || read -rp "Deneme alan adı [${TEST_DOMAIN:-$DEFAULT_TEST}] (aynısı için Enter): " INPUT
TEST_NEW=${INPUT:-${TEST_DOMAIN:-$DEFAULT_TEST}}
if ! printf '%s' "$TEST_NEW" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'; then
  echo "Geçersiz alan adı: '$TEST_NEW'"
  echo "Buraya yalnız alan adı yazılır (ör. $DEFAULT_TEST). Komutu yeniden çalıştırıp soruda Enter'a basın."
  exit 1
fi
if [ "$TEST_NEW" = "$CRM_DOMAIN" ] || [ "$TEST_NEW" = "${WA_DOMAIN:-}" ]; then echo "Deneme alan adı canlı adreslerle aynı olamaz."; exit 1; fi

PUBLIC_IP=$(curl -fsS4 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$TEST_NEW" | awk 'NR==1{print $1}' || true)
if [ -n "$PUBLIC_IP" ] && [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  echo "UYARI: $TEST_NEW şu an '${DNS_IP:-yok}' adresini gösteriyor, bu sunucu $PUBLIC_IP."
  echo "DNS'e A kaydı ekleyin ($TEST_NEW → $PUBLIC_IP), yayılmasını bekleyip tekrar çalıştırın."
  read -rp "Yine de devam edilsin mi? (e/H): " GO; [ "$GO" = "e" ] || exit 1
fi

setenv TEST_DOMAIN "$TEST_NEW"
[ -n "${TEST_SESSION_SECRET:-}" ] || setenv TEST_SESSION_SECRET "$(openssl rand -hex 48)"
chmod 600 .env

echo "1/2 Deneme sunucusu hazırlanıyor (canlı CRM çalışmaya devam ediyor)..."
$COMPOSE up -d --build crm-test

echo "2/2 Caddy: deneme alan adı..."
if [ -n "$CADDYFILE" ] && [ -f "$CADDYFILE" ]; then
  if grep -q "^$TEST_DOMAIN " "$CADDYFILE"; then
    echo "Caddy'de $TEST_DOMAIN zaten tanımlı."
  else
    BACKUP="$CADDYFILE.deneme-oncesi-$(date +%Y%m%d-%H%M%S)"
    cp "$CADDYFILE" "$BACKUP"
    # Dosya yerinde büyütülür (>>): tek dosya bağlamasında Caddy değişikliği görmeye devam eder.
    printf '\n# XRE CRM deneme kurulumu\n%s {\n\tencode gzip\n\treverse_proxy xrecrm-test:3000\n}\n' "$TEST_DOMAIN" >> "$CADDYFILE"
    if caddy_reload; then
      echo "Caddy'ye $TEST_DOMAIN eklendi (yedek: $BACKUP)."
    else
      cat "$BACKUP" > "$CADDYFILE"
      echo "HATA: Caddy yeni ayarı kabul etmedi, eski hali geri yüklendi. Şu bloğu elle ekleyin:"
      printf '%s {\n\treverse_proxy xrecrm-test:3000\n}\n' "$TEST_DOMAIN"
      exit 1
    fi
  fi
else
  echo "Caddy ayar dosyası bulunamadı. Caddyfile'a şu bloğu elle ekleyin:"
  printf '%s {\n\treverse_proxy xrecrm-test:3000\n}\n' "$TEST_DOMAIN"
fi

echo
echo "== Tamam =="
echo "Deneme adresi:   https://$TEST_DOMAIN"
echo "İlk açılışta yönetici hesabını HEMEN oluşturun (ilk hesap sistem sahibi olur)."
echo "Ücretsiz kayıt:  https://$TEST_DOMAIN/kayit"
echo "Kayıtlar:        docker logs -f xrecrm-test"
echo "Kaldırmak için:  sudo bash xrecrm/deploy/vps/deneme-kur.sh --kaldir"

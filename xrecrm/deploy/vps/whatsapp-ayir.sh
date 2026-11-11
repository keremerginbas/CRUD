#!/usr/bin/env bash
# WhatsApp by XRE'yi (Bitrix24 Market uygulaması) XRE CRM'den ayırır:
#   - ayrı alan adı (ör. whatsapp.xresoftware.com.tr), ayrı konteyner (xrecrm-wa), ayrı veri hacmi
#   - Market verisi (portallar, lisanslar, ödemeler, sohbetler, dosyalar, uygulama ayarları) CRM'den KOPYALANIR
#   - CRM bundan sonra Market verisine dokunmaz (XRE_APP_MODE=crm)
#   - eski crm adresindeki /b24 istekleri yeni sunucuya yönlendirilir (kesinti olmaz)
#   - kurulu portalların Bitrix bağlantıları açılışta yeni adrese taşınır
#
# Önce DNS: yeni alan adının A kaydını bu sunucunun IP adresine yönlendirin.
# Kullanım:   sudo bash xrecrm/deploy/vps/whatsapp-ayir.sh
# Geri alma:  sudo bash xrecrm/deploy/vps/whatsapp-ayir.sh --geri-al
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -p xrecrm"
if [ "$(id -u)" -ne 0 ]; then echo "Lütfen sudo ile çalıştırın."; exit 1; fi
[ -f .env ] || { echo ".env yok: önce kurulum.sh ile CRM'i kurun."; exit 1; }
set -a; . ./.env; set +a

setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; export "$1=$2"; }

# Mevcut Caddy ve ayar dosyası
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

if [ "${1:-}" = "--geri-al" ]; then
  echo "Geri alınıyor: WhatsApp by XRE yeniden CRM içinde çalışacak."
  setenv CRM_APP_MODE all
  if [ -n "$CADDYFILE" ] && ls "$CADDYFILE".ayirma-oncesi-* >/dev/null 2>&1; then
    LAST=$(ls -t "$CADDYFILE".ayirma-oncesi-* | head -1)
    cp "$LAST" "$CADDYFILE"
    # Yeni adres de CRM'e gitsin (Bitrix kayıtları yeni adrese taşınmış olabilir).
    if [ -n "${WA_DOMAIN:-}" ] && ! grep -q "^$WA_DOMAIN " "$CADDYFILE"; then
      printf '\n# WhatsApp by XRE (geri alındı: CRM üzerinden)\n%s {\n\tencode gzip\n\treverse_proxy xrecrm-crm:3000\n}\n' "$WA_DOMAIN" >> "$CADDYFILE"
    fi
    caddy_reload && echo "Caddy eski haline getirildi ($LAST)."
  fi
  docker stop xrecrm-wa >/dev/null 2>&1 || true
  $COMPOSE up -d crm
  echo "Tamam. Not: ayırmadan sonra yeni sunucuya gelen sohbetler/ödemeler CRM'deki kopyada yoktur."
  exit 0
fi

echo "== WhatsApp by XRE'yi CRM'den ayırma =="
DEFAULT_WA="whatsapp.${CRM_DOMAIN#*.}"
read -rp "Yeni alan adı [$DEFAULT_WA]: " WA_INPUT
WA_DOMAIN_NEW=${WA_INPUT:-$DEFAULT_WA}
if [ "$WA_DOMAIN_NEW" = "$CRM_DOMAIN" ]; then echo "Yeni alan adı CRM ile aynı olamaz."; exit 1; fi

PUBLIC_IP=$(curl -fsS4 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$WA_DOMAIN_NEW" | awk 'NR==1{print $1}' || true)
if [ -n "$PUBLIC_IP" ] && [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  echo "UYARI: $WA_DOMAIN_NEW şu an '${DNS_IP:-yok}' adresini gösteriyor, bu sunucu $PUBLIC_IP."
  echo "DNS'e A kaydı ekleyin ($WA_DOMAIN_NEW → $PUBLIC_IP), yayılmasını bekleyip tekrar çalıştırın."
  read -rp "Yine de devam edilsin mi? (e/H): " GO; [ "$GO" = "e" ] || exit 1
fi

setenv WA_DOMAIN "$WA_DOMAIN_NEW"
if [ -z "${B24_ADMIN_PASSWORD:-}" ]; then
  setenv B24_ADMIN_PASSWORD "$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  NEW_PASSWORD=1
fi
chmod 600 .env

echo "1/5 Uygulama imajı hazırlanıyor (CRM çalışmaya devam ediyor)..."
$COMPOSE --profile whatsapp build whatsapp crm

echo "2/5 Kısa bakım: CRM durduruluyor ve verisi diske yazılıyor..."
docker stop xrecrm-crm >/dev/null

echo "3/5 Market verisi yeni sunucuya kopyalanıyor (CRM verisi değişmez)..."
if ! $COMPOSE --profile whatsapp run --rm --no-deps whatsapp node dist/server.js --migrate-from /crm-data; then
  echo "Taşıma başarısız. CRM eski haliyle yeniden başlatılıyor."
  docker start xrecrm-crm >/dev/null
  exit 1
fi

echo "4/5 Sunucular başlatılıyor..."
setenv CRM_APP_MODE crm
$COMPOSE --profile whatsapp up -d whatsapp crm

echo "5/5 Caddy: yeni alan adı ve eski adresin yönlendirmesi..."
if [ -n "$CADDYFILE" ] && [ -f "$CADDYFILE" ]; then
  BACKUP="$CADDYFILE.ayirma-oncesi-$(date +%Y%m%d-%H%M%S)"
  cp "$CADDYFILE" "$BACKUP"
  python3 - "$CADDYFILE" "$CRM_DOMAIN" "$WA_DOMAIN" <<'PY'
import re, sys
path, crm, wa = sys.argv[1:4]
s = open(path).read()
# Eski adresteki uygulama istekleri (Bitrix'e kayıtlı adresler) yeni sunucuya gider.
route = ("\t@whatsapp path /b24 /b24/* /api/b24-admin/*\n\thandle @whatsapp {\n\t\treverse_proxy xrecrm-wa:3000\n\t}\n"
         "\thandle {\n\t\treverse_proxy xrecrm-crm:3000\n\t}\n")
m = re.search(r"(?m)^" + re.escape(crm) + r"\s*\{\n(.*?)^\}", s, re.S)
if m and "@whatsapp" not in m.group(1):
    body = re.sub(r"(?m)^\s*reverse_proxy\s+xrecrm-crm:3000\s*\n", route, m.group(1), count=1)
    s = s[:m.start(1)] + body + s[m.end(1):]
if not re.search(r"(?m)^" + re.escape(wa) + r"\s*\{", s):
    s += "\n# WhatsApp by XRE\n%s {\n\tencode gzip\n\treverse_proxy xrecrm-wa:3000\n}\n" % wa
open(path, "w").write(s)
PY
  if caddy_reload; then
    echo "Caddy güncellendi (yedek: $BACKUP)."
  else
    cp "$BACKUP" "$CADDYFILE"
    echo "HATA: Caddy yeni ayarı kabul etmedi, eski hali geri yüklendi. Ayırmayı geri almak için:"
    echo "  sudo bash xrecrm/deploy/vps/whatsapp-ayir.sh --geri-al"
    exit 1
  fi
else
  echo "Caddy ayar dosyası bulunamadı. Caddyfile'a şunları elle ekleyin:"
  printf '%s {\n\treverse_proxy xrecrm-wa:3000\n}\n' "$WA_DOMAIN"
  echo "ve $CRM_DOMAIN bloğunda /b24/* ile /api/b24-admin/* yollarını xrecrm-wa:3000'e yönlendirin."
fi

sleep 8
echo
echo "== Tamam =="
echo "WhatsApp by XRE:   https://$WA_DOMAIN/b24/support"
echo "Yönetim ekranı:    https://$WA_DOMAIN/b24/admin"
if [ -n "${NEW_PASSWORD:-}" ]; then echo "Yönetim şifresi:   $B24_ADMIN_PASSWORD   (.env dosyasında B24_ADMIN_PASSWORD; bir yere not edin)"; fi
echo "Kayıtlar:          docker logs -f xrecrm-wa"
echo
echo "Kontrol: docker logs xrecrm-wa 2>&1 | grep -E 'taşındı|sunucusu'"
echo "Bitrix partner panelinde uygulama adreslerini https://$WA_DOMAIN/... olarak güncelleyin (rehber: docs/market/AYIRMA.md)."
echo "Geri almak için:   sudo bash xrecrm/deploy/vps/whatsapp-ayir.sh --geri-al"

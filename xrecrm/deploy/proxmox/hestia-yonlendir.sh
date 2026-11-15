#!/usr/bin/env bash
# Hestia'da yeni bir alan adını iç ağdaki bir makineye yönlendirir (ters vekil) ve Let's Encrypt sertifikası alır.
# Zaten çalışan bir yönlendirmenin (ör. ofiscrm) şablonu örnek alınır; yalnız hedef adres değiştirilir.
#
# Hestia makinesinde root olarak:
#   bash hestia-yonlendir.sh <yeni-alan-adı> <hedef-ip:kapı> [örnek-alan-adı] [hestia-kullanıcısı]
#   bash hestia-yonlendir.sh trinvest.xresoftware.com.tr 192.168.1.190:3000 ofiscrm.xresoftware.com.tr xresoftware
set -euo pipefail
DOMAIN="${1:-}"; TARGET="${2:-}"; MODEL="${3:-ofiscrm.xresoftware.com.tr}"; HUSER="${4:-xresoftware}"
BIN=/usr/local/hestia/bin
TPLDIR=/usr/local/hestia/data/templates/web/nginx
[ "$(id -u)" -eq 0 ] || { echo "Lütfen root olarak çalıştırın."; exit 1; }
printf '%s' "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' || { echo "Kullanım: bash hestia-yonlendir.sh <alan-adı> <ip:kapı> [örnek-alan-adı] [kullanıcı]"; exit 1; }
printf '%s' "$TARGET" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}:[0-9]{2,5}$' || { echo "Hedef 192.168.1.190:3000 biçiminde olmalı."; exit 1; }
[ -x "$BIN/v-list-web-domain" ] || { echo "Hestia bulunamadı ($BIN). Bu betik Hestia makinesinde çalıştırılmalı."; exit 1; }

echo "== $DOMAIN → $TARGET =="
echo "0/5 Hedef makine yanıt veriyor mu?"
if curl -fsS -m 8 "http://$TARGET/health" >/dev/null 2>&1; then echo "    Evet."; else
  echo "    HAYIR: http://$TARGET/health yanıt vermiyor. Önce CRM makinesinin kurulumunu tamamlayın."; exit 1; fi

echo "1/5 Örnek alan adının şablonu okunuyor ($MODEL)..."
INFO=$("$BIN/v-list-web-domain" "$HUSER" "$MODEL" shell 2>/dev/null) || { echo "    $MODEL bulunamadı. Çalışan bir yönlendirmenizin adını 3. değer olarak verin."; exit 1; }
PTPL=$(printf '%s\n' "$INFO" | awk -F': *' 'toupper($1) ~ /^PROXY$/ {print $2; exit}' | tr -d ' ')
[ -n "$PTPL" ] || PTPL=$(printf '%s\n' "$INFO" | awk -F': *' 'toupper($1) ~ /PROXY/ && $2 !~ /^$/ {v=$2} END{print v}' | tr -d ' ')
echo "    Örnek şablon: ${PTPL:-bulunamadı}"
if [ -z "$PTPL" ] || [ ! -f "$TPLDIR/$PTPL.tpl" ] || [ ! -f "$TPLDIR/$PTPL.stpl" ]; then
  echo "    Şablon dosyası bulunamadı. Aşağıdaki çıktıyı gönderin:"; printf '%s\n' "$INFO"; ls "$TPLDIR" | head -40; exit 1
fi
if ! grep -q 'proxy_pass' "$TPLDIR/$PTPL.stpl"; then
  echo "    Bu şablonda yönlendirme (proxy_pass) yok. Aşağıdaki çıktıyı gönderin:"; printf '%s\n' "$INFO"; exit 1
fi

NEW="xre-$(printf '%s' "$DOMAIN" | cut -d. -f1 | tr -cd 'a-z0-9-')"
echo "2/5 Yeni şablon hazırlanıyor ($NEW)..."
for ext in tpl stpl; do
  # Örnek şablondaki bütün hedefler yeni makineye çevrilir; gerisi (başlıklar, sertifika, süreler) aynen kalır.
  sed -E "s#proxy_pass[[:space:]]+https?://[^;]+;#proxy_pass http://$TARGET;#g" "$TPLDIR/$PTPL.$ext" > "$TPLDIR/$NEW.$ext"
  chmod 644 "$TPLDIR/$NEW.$ext"
done
grep -n 'proxy_pass' "$TPLDIR/$NEW.stpl" | sed 's/^/    /'

echo "3/5 Alan adı ekleniyor..."
if "$BIN/v-list-web-domain" "$HUSER" "$DOMAIN" >/dev/null 2>&1; then echo "    Zaten var."; else "$BIN/v-add-web-domain" "$HUSER" "$DOMAIN"; fi

echo "4/5 Şablon uygulanıyor..."
"$BIN/v-change-web-domain-proxy-tpl" "$HUSER" "$DOMAIN" "$NEW"

echo "5/5 Sertifika alınıyor (Let's Encrypt)..."
if "$BIN/v-add-letsencrypt-domain" "$HUSER" "$DOMAIN" '' ; then
  "$BIN/v-add-web-domain-ssl-force" "$HUSER" "$DOMAIN" >/dev/null 2>&1 || true
  echo "    Sertifika alındı."
else
  echo "    Sertifika ALINAMADI. DNS kaydının ($DOMAIN → bu sunucunun dış IP adresi) yayıldığından emin olup şunu yeniden çalıştırın:"
  echo "    $BIN/v-add-letsencrypt-domain $HUSER $DOMAIN"
fi

echo
CODE=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$DOMAIN/health" || true)
if [ "$CODE" = "200" ]; then echo "== Tamam: https://$DOMAIN çalışıyor =="; else echo "https://$DOMAIN/health → ${CODE:-yanıt yok}. Birkaç dakika sonra tarayıcıdan deneyin; açılmazsa bu çıktının tamamını gönderin."; fi

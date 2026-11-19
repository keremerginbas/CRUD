#!/usr/bin/env bash
# SMS (Erccell CORPORATESMS) bilgilerini sunucunun .env dosyasına yazar. Şifre ekranda görünmez, depoya gitmez.
# Proxmox'ta:  pct exec 140 -- /opt/santral/server/deploy/sms-setup.sh
set -euo pipefail
ENV=/opt/santral/server/.env
URL_DEFAULT=https://gateway.erccell.com.tr/corporatesms/sendsms/
read -rp "SMS adresi (değiştirmeyecekseniz sadece Enter) [$URL_DEFAULT]: " URL; URL="${URL:-$URL_DEFAULT}"
[[ "$URL" =~ ^https?:// ]] || { echo "Adres https:// ile başlamalı (yazılan: $URL). Tekrar çalıştırıp ilk soruda sadece Enter'a basın."; exit 1; }
read -rp "Kullanıcı adı: " USERNAME
read -rsp "Şifre (yazarken görünmez): " PASSWORD; echo
read -rp "Başlık [XRE]: " HEADER; HEADER="${HEADER:-XRE}"
read -rp "Numara biçimi: 90 (905XX..., Erccell), 0 (05XX...), 10 (5XX...) [90]: " FMT; FMT="${FMT:-90}"
[[ "$FMT" =~ ^(0|10|90)$ ]] || { echo "Biçim 0, 10 ya da 90 olmalı"; exit 1; }
[[ -n "$USERNAME" && -n "$PASSWORD" ]] || { echo "Kullanıcı adı ve şifre zorunlu"; exit 1; }
[[ "$PASSWORD$USERNAME" != *$'\n'* ]] || exit 1
touch "$ENV"
sed -i '/^SMS_\(API_URL\|USERNAME\|PASSWORD\|HEADER\|TYPE\|NUMBER_FORMAT\)=/d' "$ENV"
printf 'SMS_API_URL=%s\nSMS_USERNAME=%s\nSMS_PASSWORD=%s\nSMS_HEADER=%s\nSMS_TYPE=UC\nSMS_NUMBER_FORMAT=%s\n' "$URL" "$USERNAME" "$PASSWORD" "$HEADER" "$FMT" >> "$ENV"
chmod 600 "$ENV"; chown santral:santral "$ENV" 2>/dev/null || true
systemctl restart santral
echo "== Kaydedildi, servis yeniden başlatıldı. Deneme: node --env-file=.env src/sms-deneme.js 05XXXXXXXXX"

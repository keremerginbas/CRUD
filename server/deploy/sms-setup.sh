#!/usr/bin/env bash
# SMS (Erccell CORPORATESMS) bilgilerini sunucunun .env dosyasına yazar. Şifre ekranda görünmez, depoya gitmez.
# Proxmox'ta:  pct exec 140 -- /opt/santral/server/deploy/sms-setup.sh
set -euo pipefail
ENV=/opt/santral/server/.env
URL_DEFAULT=https://gateway.erccell.com.tr/corporatesms/sendsms/
read -rp "SMS adresi [$URL_DEFAULT]: " URL; URL="${URL:-$URL_DEFAULT}"
read -rp "Kullanıcı adı: " USERNAME
read -rsp "Şifre (yazarken görünmez): " PASSWORD; echo
read -rp "Başlık [XRE]: " HEADER; HEADER="${HEADER:-XRE}"
[[ -n "$USERNAME" && -n "$PASSWORD" ]] || { echo "Kullanıcı adı ve şifre zorunlu"; exit 1; }
[[ "$PASSWORD$USERNAME" != *$'\n'* ]] || exit 1
touch "$ENV"
sed -i '/^SMS_\(API_URL\|USERNAME\|PASSWORD\|HEADER\|TYPE\)=/d' "$ENV"
printf 'SMS_API_URL=%s\nSMS_USERNAME=%s\nSMS_PASSWORD=%s\nSMS_HEADER=%s\nSMS_TYPE=UC\n' "$URL" "$USERNAME" "$PASSWORD" "$HEADER" >> "$ENV"
chmod 600 "$ENV"; chown santral:santral "$ENV" 2>/dev/null || true
systemctl restart santral
echo "== Kaydedildi, servis yeniden başlatıldı. Deneme: node --env-file=.env src/sms-deneme.js 05XXXXXXXXX"

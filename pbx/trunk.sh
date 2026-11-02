#!/usr/bin/env bash
# Operatör SIP trunk'ını santrale bağlar (Türk Telekom, Netgsm vb.). Şifre ekranda görünmez ve
# sadece bu sunucuda kalır. Santral konteynerinde (CT 150) root olarak:  /opt/santral/pbx/trunk.sh
# İsteğe bağlı ad: "trunk" (varsayılan; müşteri tarafı, maske numarası) ya da "agent" (danışmanları arayan
# ikinci dahili; operatör bir dahiliden aynı anda tek görüşmeye izin veriyorsa gerekir):
#   /opt/santral/pbx/trunk.sh agent
# İki doğrulama yöntemi desteklenir:
#   1) Kullanıcı adı/şifre ile kayıt (register): santral operatöre kendini kaydeder
#   2) IP doğrulama: operatör, santralin sabit IP'sini (81.214.28.155) tanır; şifre yoktur
set -euo pipefail
CONF=/etc/asterisk
NAME="${1:-trunk}"
[[ "$NAME" == "trunk" || "$NAME" == "agent" ]] || { echo "Ad trunk ya da agent olmalı"; exit 1; }
echo "== Bağlantı: $NAME"

read -rp "Operatör adı (bilgi için, ör. Türk Telekom): " OPERATOR
read -rp "Operatörün SIP sunucusu (alan adı ya da IP): " HOST
[[ -n "$HOST" ]] || { echo "SIP sunucusu zorunlu"; exit 1; }
read -rp "Doğrulama yöntemi: 1) kullanıcı adı/şifre  2) IP doğrulama [1]: " MODE
MODE="${MODE:-1}"
read -rp "Operatörün bildirdiği ek SIP IP adresleri (boşlukla ayırın, yoksa Enter): " EXTRA
DID=""
[[ "$NAME" != "trunk" ]] || read -rp "Bu trunk'a/dahiliye gelen hattın numarası (ör. 5337437589; operatör aranan numarayı iletmezse kullanılır): " DID

if [[ "$MODE" == "1" ]]; then
  read -rp "Trunk kullanıcı adı: " SIPUSER
  read -rsp "Trunk şifresi (yazarken görünmez): " SIPPASS; echo
  [[ -n "$SIPUSER" && -n "$SIPPASS" ]] || { echo "Kullanıcı adı ve şifre zorunlu"; exit 1; }
  if [[ "$SIPPASS$SIPUSER" == *";"* ]]; then
    echo "';' karakteri Asterisk ayar dosyasında yorum sayılır; operatörden bu karakter olmadan bir şifre isteyin."; exit 1
  fi
fi

umask 027
{
  echo "; pbx/trunk.sh tarafından yazıldı ($OPERATOR). Elle düzenlemeyin; scripti tekrar çalıştırın."
  if [[ "$MODE" == "1" ]]; then
    cat <<CONFEOF
[$NAME-auth]
type=auth
auth_type=userpass
username=$SIPUSER
password=$SIPPASS

[$NAME-reg]
type=registration
transport=transport-udp
outbound_auth=$NAME-auth
server_uri=sip:$HOST
client_uri=sip:$SIPUSER@$HOST
contact_user=$SIPUSER
retry_interval=60
forbidden_retry_interval=600
expiration=3600
line=yes
endpoint=$NAME
CONFEOF
  fi
  cat <<CONFEOF

[$NAME]
type=aor
contact=sip:$HOST
qualify_frequency=60

[$NAME]
type=endpoint
transport=transport-udp
context=from-trunk
disallow=all
allow=alaw,ulaw
aors=$NAME
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733
CONFEOF
  if [[ "$MODE" == "1" ]]; then
    printf 'outbound_auth=%s-auth\nfrom_user=%s\nfrom_domain=%s\n' "$NAME" "$SIPUSER" "$HOST"
  fi
  printf '\n[%s-identify]\ntype=identify\nendpoint=%s\nmatch=%s\n' "$NAME" "$NAME" "$HOST"
  for ip in $EXTRA; do echo "match=$ip"; done
} > "$CONF/pjsip_$NAME.conf"

# Sadece operatörün adreslerinden SIP kabul et
IPS="$( { getent ahostsv4 "$HOST" | awk '{print $1}'; for ip in $EXTRA; do echo "$ip"; done; } | sort -u)"
: > "$CONF/pjsip_${NAME}_acl.conf"
for ip in $IPS; do echo "permit=$ip/255.255.255.255" >> "$CONF/pjsip_${NAME}_acl.conf"; done
echo "== İzin verilen operatör adresleri:"; sed 's/^permit=/   /' "$CONF/pjsip_${NAME}_acl.conf"

if [[ "$NAME" == "trunk" ]]; then
  printf '; pbx/trunk.sh tarafından yazıldı\nTRUNK_DID=%s\n' "$DID" > "$CONF/xre_trunk.conf"
fi
chown asterisk:asterisk "$CONF"/pjsip_${NAME}*.conf "$CONF/xre_trunk.conf"
asterisk -rx 'dialplan reload' >/dev/null
asterisk -rx 'module reload res_pjsip.so' >/dev/null
sleep 5
if [[ "$MODE" == "1" ]]; then
  echo "== Kayıt durumu (Registered görünmeli):"
  asterisk -rx 'pjsip show registrations'
fi
echo "== Operatöre erişim (Avail görünmeli):"
asterisk -rx "pjsip show aor $NAME" | grep -i "contact:" || true
if [[ "$NAME" == "agent" ]]; then
  echo "== Şimdi Proxmox'ta connect.sh'yi tekrar çalıştırın; danışman aramaları bu dahiliden yapılacak."
fi

#!/usr/bin/env bash
# Netgsm SIP trunk bilgilerini santrale yazar. Şifre ekranda görünmez ve sadece bu sunucuda kalır.
# Santral konteynerinde (CT 150) root olarak:  /opt/santral/pbx/trunk.sh
set -euo pipefail
CONF=/etc/asterisk

read -rp "SIP sunucusu [sip8.netsantral.com]: " HOST
HOST="${HOST:-sip8.netsantral.com}"
read -rp "Trunk kullanıcı adı: " SIPUSER
read -rsp "Trunk şifresi (yazarken görünmez): " SIPPASS; echo
[[ -n "$SIPUSER" && -n "$SIPPASS" ]] || { echo "Kullanıcı adı ve şifre zorunlu"; exit 1; }
if [[ "$SIPPASS" == *";"* || "$SIPUSER" == *";"* ]]; then
  echo "Şifrede ';' karakteri Asterisk ayar dosyasında yorum sayılır; Netgsm'den bu karakter olmadan bir şifre isteyin."; exit 1
fi

umask 027
cat > "$CONF/pjsip_netgsm.conf" <<CONFEOF
; pbx/trunk.sh tarafından yazıldı. Elle düzenlemeyin; scripti tekrar çalıştırın.
[netgsm-auth]
type=auth
auth_type=userpass
username=$SIPUSER
password=$SIPPASS

[netgsm-reg]
type=registration
transport=transport-udp
outbound_auth=netgsm-auth
server_uri=sip:$HOST
client_uri=sip:$SIPUSER@$HOST
contact_user=$SIPUSER
retry_interval=60
forbidden_retry_interval=600
expiration=3600
line=yes
endpoint=netgsm

[netgsm]
type=aor
contact=sip:$HOST
qualify_frequency=60

[netgsm]
type=endpoint
transport=transport-udp
context=from-netgsm
disallow=all
allow=alaw,ulaw
outbound_auth=netgsm-auth
aors=netgsm
from_user=$SIPUSER
from_domain=$HOST
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733

[netgsm-identify]
type=identify
endpoint=netgsm
match=$HOST
CONFEOF

# Sadece Netgsm adreslerinden SIP kabul et (NETGSM_EXTRA_IPS ile ek adresler verilebilir)
IPS="$(getent ahostsv4 "$HOST" | awk '{print $1}' | sort -u) ${NETGSM_EXTRA_IPS:-}"
: > "$CONF/pjsip_netgsm_acl.conf"
for ip in $IPS; do echo "permit=$ip/255.255.255.255" >> "$CONF/pjsip_netgsm_acl.conf"; done
echo "== İzin verilen Netgsm adresleri:"; cat "$CONF/pjsip_netgsm_acl.conf"

chown asterisk:asterisk "$CONF/pjsip_netgsm.conf" "$CONF/pjsip_netgsm_acl.conf"
asterisk -rx 'module reload res_pjsip.so' >/dev/null
sleep 5
echo "== Kayıt durumu (Registered görünmeli):"
asterisk -rx 'pjsip show registrations'

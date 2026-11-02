#!/usr/bin/env bash
# Operatör SIP trunk'ını santrale bağlar (Türk Telekom, Netgsm vb.). Şifre ekranda görünmez ve
# sadece bu sunucuda kalır. Santral konteynerinde (CT 150) root olarak:  /opt/santral/pbx/trunk.sh
# İki doğrulama yöntemi desteklenir:
#   1) Kullanıcı adı/şifre ile kayıt (register): santral operatöre kendini kaydeder
#   2) IP doğrulama: operatör, santralin sabit IP'sini (81.214.28.155) tanır; şifre yoktur
set -euo pipefail
CONF=/etc/asterisk

read -rp "Operatör adı (bilgi için, ör. Türk Telekom): " OPERATOR
read -rp "Operatörün SIP sunucusu (alan adı ya da IP): " HOST
[[ -n "$HOST" ]] || { echo "SIP sunucusu zorunlu"; exit 1; }
read -rp "Doğrulama yöntemi: 1) kullanıcı adı/şifre  2) IP doğrulama [1]: " MODE
MODE="${MODE:-1}"
read -rp "Operatörün bildirdiği ek SIP IP adresleri (boşlukla ayırın, yoksa Enter): " EXTRA
read -rp "Bu trunk'a/dahiliye gelen hattın numarası (ör. 5337437589; operatör aranan numarayı iletmezse kullanılır): " DID

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
[trunk-auth]
type=auth
auth_type=userpass
username=$SIPUSER
password=$SIPPASS

[trunk-reg]
type=registration
transport=transport-udp
outbound_auth=trunk-auth
server_uri=sip:$HOST
client_uri=sip:$SIPUSER@$HOST
contact_user=$SIPUSER
retry_interval=60
forbidden_retry_interval=600
expiration=3600
line=yes
endpoint=trunk
CONFEOF
  fi
  cat <<CONFEOF

[trunk]
type=aor
contact=sip:$HOST
qualify_frequency=60

[trunk]
type=endpoint
transport=transport-udp
context=from-trunk
disallow=all
allow=alaw,ulaw
aors=trunk
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733
CONFEOF
  if [[ "$MODE" == "1" ]]; then
    printf 'outbound_auth=trunk-auth\nfrom_user=%s\nfrom_domain=%s\n' "$SIPUSER" "$HOST"
  fi
  printf '\n[trunk-identify]\ntype=identify\nendpoint=trunk\nmatch=%s\n' "$HOST"
  for ip in $EXTRA; do echo "match=$ip"; done
} > "$CONF/pjsip_trunk.conf"

# Sadece operatörün adreslerinden SIP kabul et
IPS="$(getent ahostsv4 "$HOST" | awk '{print $1}' | sort -u) $EXTRA"
: > "$CONF/pjsip_trunk_acl.conf"
for ip in $IPS; do echo "permit=$ip/255.255.255.255" >> "$CONF/pjsip_trunk_acl.conf"; done
echo "== İzin verilen operatör adresleri:"; sed 's/^permit=/   /' "$CONF/pjsip_trunk_acl.conf"

printf '; pbx/trunk.sh tarafından yazıldı\nTRUNK_DID=%s\n' "$DID" > "$CONF/xre_trunk.conf"
chown asterisk:asterisk "$CONF/pjsip_trunk.conf" "$CONF/pjsip_trunk_acl.conf" "$CONF/xre_trunk.conf"
asterisk -rx 'dialplan reload' >/dev/null
asterisk -rx 'module reload res_pjsip.so' >/dev/null
sleep 5
if [[ "$MODE" == "1" ]]; then
  echo "== Kayıt durumu (Registered görünmeli):"
  asterisk -rx 'pjsip show registrations'
fi
echo "== Operatöre erişim (Avail görünmeli):"
asterisk -rx 'pjsip show aor trunk' | grep -i "contact:" || true

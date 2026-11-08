#!/usr/bin/env bash
# Operatör SIP trunk'ını santrale bağlar (Netgsm, Verimor, Türk Telekom ya da başka bir operatör).
# Aynı anda birden fazla operatör bağlanabilir; her bağlantının bir adı vardır. Şifre ekranda görünmez
# ve sadece bu sunucuda kalır. Santral konteynerinde (CT 150) root olarak:
#   /opt/santral/pbx/trunk.sh            → "trunk" adlı varsayılan bağlantı
#   /opt/santral/pbx/trunk.sh tt         → "tt" adlı ikinci bağlantı (ör. Türk Telekom 0312 numaraları)
#   /opt/santral/pbx/trunk.sh agent      → sadece danışmanların cebini arayan bağlantı (gelen arama açmaz)
#   /opt/santral/pbx/trunk.sh --sil tt   → bağlantıyı kaldırır
# Ad: küçük harf, rakam ve _ (2-20 karakter). Her numara panelde (Ekip → Hatlar) bir bağlantıya bağlanır;
# o numarayla yapılan giden aramalar o bağlantıdan çıkar. Gelen aramada bağlantı otomatik öğrenilir.
# İki doğrulama yöntemi desteklenir:
#   1) Kullanıcı adı/şifre ile kayıt (register): santral operatöre kendini kaydeder
#   2) IP doğrulama: operatör santralin sabit IP'sini (81.214.28.155) tanır; şifre yoktur
set -euo pipefail
CONF="${XRE_CONF:-/etc/asterisk}"
D="$CONF/xre.d"
ast() { asterisk ${ASTERISK_OPTS:-} -rx "$1"; }

if [[ "${1:-}" == "--sil" ]]; then
  NAME="${2:-}"
  [[ -f "$D/pjsip-$NAME.conf" ]] || { echo "Böyle bir bağlantı yok: $NAME"; exit 1; }
  rm -f "$D/pjsip-$NAME.conf" "$D/acl-$NAME.conf" "$D/globals-$NAME.conf"
  ast 'dialplan reload' >/dev/null; ast 'module reload res_pjsip.so' >/dev/null
  echo "== $NAME kaldırıldı. Bu bağlantıya bağlı hatlar panelde (Ekip → Hatlar) başka bağlantıya alınmalı."
  exit 0
fi

NAME="${1:-trunk}"
[[ "$NAME" =~ ^[a-z][a-z0-9_]{1,19}$ ]] || { echo "Ad küçük harf, rakam ve _ olmalı (2-20 karakter): $NAME"; exit 1; }
[[ "$NAME" =~ ^(u[0-9]+|xre_.*)$ ]] && { echo "Bu ad santralde ayrılmış: $NAME"; exit 1; }
mkdir -p "$D"
echo "== Bağlantı: $NAME"
# Danışmanları arayan bağlantı gelen arama kabul etmez (from-agent meşgul döner)
CONTEXT=from-trunk; [[ "$NAME" == "agent" ]] && CONTEXT=from-agent

echo "Operatör: 1) Netgsm  2) Verimor  3) Türk Telekom  4) Diğer"
read -rp "Seçim [4]: " OP
case "${OP:-4}" in
  1) OPERATOR=Netgsm; HINT="ör. sip8.netsantral.com (Netgsm panelinde hesabınızın SIP sunucusu)" ;;
  2) OPERATOR=Verimor; HINT="ör. sip.verimor.com.tr" ;;
  3) OPERATOR="Türk Telekom"; HINT="Türk Telekom'un verdiği SIP sunucu adresi/IP" ;;
  *) read -rp "Operatör adı (bilgi için): " OPERATOR; HINT="alan adı ya da IP" ;;
esac
read -rp "Operatörün SIP sunucusu ($HINT; port farklıysa sunucu:port): " HOST
[[ "$HOST" =~ ^[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || { echo "Geçersiz SIP sunucusu: $HOST"; exit 1; }
HOSTNAME_ONLY="${HOST%%:*}"
read -rp "Doğrulama yöntemi: 1) kullanıcı adı/şifre  2) IP doğrulama [1]: " MODE
MODE="${MODE:-1}"
read -rp "Operatörün bildirdiği ek SIP IP adresleri (boşlukla ayırın, yoksa Enter): " EXTRA
for ip in $EXTRA; do [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "Geçersiz IP: $ip"; exit 1; }; done
read -rp "Bu bağlantının ana numarası (ör. 8503465993; operatör aranan numarayı iletmezse kullanılır): " DID
DID="${DID//[^0-9]/}"
read -rp "Aynı anda kaç görüşme (kanal) var? [1]: " CH
CH="${CH:-1}"; [[ "$CH" =~ ^[0-9]{1,3}$ && "$CH" -ge 1 ]] || { echo "Kanal sayısı 1 ya da daha büyük olmalı"; exit 1; }
echo "Arayan numara operatöre hangi biçimde gönderilsin? (operatörün istediği biçim; emin değilseniz 10)"
echo "  10) 3122191672   0) 03122191672   90) 903122191672   +90) +903122191672"
read -rp "Biçim [10]: " CLI
CLI="${CLI:-10}"; [[ "$CLI" =~ ^(10|0|90|\+90)$ ]] || { echo "Biçim 10, 0, 90 ya da +90 olmalı"; exit 1; }

if [[ "$MODE" == "1" ]]; then
  read -rp "Trunk kullanıcı adı: " SIPUSER
  read -rsp "Trunk şifresi (yazarken görünmez): " SIPPASS; echo
  [[ -n "$SIPUSER" && -n "$SIPPASS" ]] || { echo "Kullanıcı adı ve şifre zorunlu"; exit 1; }
  [[ "$SIPUSER" =~ ^[A-Za-z0-9._@+-]+$ ]] || { echo "Kullanıcı adında geçersiz karakter"; exit 1; }
  if [[ "$SIPPASS" == *";"* || "$SIPPASS" =~ [[:space:]] ]]; then
    echo "';' ve boşluk Asterisk ayar dosyasında sorun çıkarır; operatörden bu karakterler olmadan bir şifre isteyin."; exit 1
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
context=$CONTEXT
disallow=all
allow=alaw,ulaw
aors=$NAME
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733
set_var=XRE_TRUNK=$NAME
CONFEOF
  [[ -z "$DID" ]] || echo "set_var=XRE_LINE_DID=$DID"
  if [[ "$MODE" == "1" ]]; then
    printf 'outbound_auth=%s-auth\nfrom_user=%s\nfrom_domain=%s\n' "$NAME" "$SIPUSER" "$HOSTNAME_ONLY"
  fi
  printf '\n[%s-identify]\ntype=identify\nendpoint=%s\nmatch=%s\n' "$NAME" "$NAME" "$HOSTNAME_ONLY"
  for ip in $EXTRA; do echo "match=$ip"; done
} > "$D/pjsip-$NAME.conf.new"

# Sadece operatörün adreslerinden SIP kabul et
IPS="$( { getent ahostsv4 "$HOSTNAME_ONLY" | awk '{print $1}'; for ip in $EXTRA; do echo "$ip"; done; } | sort -u)"
[[ -n "$IPS" ]] || { rm -f "$D/pjsip-$NAME.conf.new"; echo "SIP sunucusunun adresi bulunamadı: $HOSTNAME_ONLY"; exit 1; }
{ echo "; pbx/trunk.sh: $NAME ($OPERATOR)"; for ip in $IPS; do echo "permit=$ip/255.255.255.255"; done; } > "$D/acl-$NAME.conf"

# Dialplan'ın bu bağlantı hakkında bildikleri (extensions.conf [globals])
cat > "$D/globals-$NAME.conf" <<CONFEOF
; pbx/trunk.sh: $NAME ($OPERATOR)
HOST_$NAME=$HOSTNAME_ONLY
CLI_$NAME=$CLI
CH_$NAME=$CH
DID_$NAME=$DID
CONFEOF
mv "$D/pjsip-$NAME.conf.new" "$D/pjsip-$NAME.conf"

# Eski sürümün (tek trunk) dosyaları: aynı tanım iki kez yüklenmesin
for old in "pjsip_$NAME.conf" "pjsip_${NAME}_acl.conf"; do
  [[ -s "$CONF/$old" ]] && : > "$CONF/$old"
done
if [[ "$NAME" == "trunk" ]]; then
  printf '; pbx/trunk.sh tarafından yazıldı\nTRUNK_DID=%s\nTRUNK_HOST=%s\n' "$DID" "$HOSTNAME_ONLY" > "$CONF/xre_trunk.conf"
fi
chown -R asterisk:asterisk "$D" "$CONF/xre_trunk.conf" 2>/dev/null || true

echo "== İzin verilen operatör adresleri:"; grep '^permit=' "$D/acl-$NAME.conf" | sed 's/^permit=/   /;s#/255.255.255.255##'
ast 'dialplan reload' >/dev/null
ast 'module reload res_pjsip.so' >/dev/null
sleep "${XRE_WAIT:-5}"
if [[ "$MODE" == "1" ]]; then
  echo "== Kayıt durumu (Registered görünmeli):"
  ast 'pjsip show registrations' | grep -E "^ *$NAME-reg|Registered|Rejected|Unregistered" || true
fi
echo "== Operatöre erişim (Avail görünmeli):"
ast "pjsip show aor $NAME" | grep -i "contact:" || true
cat <<MSG
== Bitti: $NAME ($OPERATOR, $CH kanal, arayan numara biçimi $CLI)
   Bu bağlantıdaki numaraları panelde Ekip → Hatlar'da "$NAME" bağlantısına bağlayın
   (gelen ilk aramada otomatik de öğrenilir). Kontrol: /opt/santral/pbx/doctor.sh
MSG

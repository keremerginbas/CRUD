#!/usr/bin/env bash
# =====================================================================
#  NetGSM → ofis sunucusu SES KALİTESİ TESTİ (Asterisk)
#  Ubuntu 24.04 sanal makinede root olarak çalıştırın:  sudo bash kur.sh
#
#  Canlı Vapi hatlarına DOKUNMAZ: NetSantral'da test için açtığınız
#  AYRI bir dahili ile kayıt olur.
#  - Gelen arama: dahiliye gelen çağrıyı açar, "echo" yapar (söylediğinizi
#    geri duyarsınız) ve kaydeder.
#  - Giden arama: bash ara.sh 05XXXXXXXXX
#  - Her aramanın paket kaybı/jitter değeri: bash kalite.sh
# =====================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "root olarak çalıştırın: sudo bash kur.sh"; exit 1; fi

echo "== NetSantral test dahilisi bilgileri =="
read -rp "SIP sunucusu [sip8.netsantral.com]: " SIP_HOST; SIP_HOST=${SIP_HOST:-sip8.netsantral.com}
read -rp "Dahili kullanıcı adı (NetSantral'da açtığınız TEST dahilisi): " SIP_USER
read -rsp "Dahili şifresi: " SIP_PASS; echo
[ -n "$SIP_USER" ] && [ -n "$SIP_PASS" ] || { echo "Kullanıcı adı ve şifre gerekli."; exit 1; }

echo "== Paketler kuruluyor =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q asterisk curl dnsutils ufw

PUBLIC_IP=$(curl -s4 https://ifconfig.me || true); PUBLIC_IP=${PUBLIC_IP:-81.214.28.155}
# Ofisteki mevcut santral (192.168.1.247) UDP 5060 ve 10000-10200 kullanıyor; test çakışmasın diye farklı portlar
read -rp "Test SIP portu [5070]: " SIP_PORT; SIP_PORT=${SIP_PORT:-5070}
read -rp "Test ses (RTP) port aralığı başlangıcı [20000]: " RTP_BAS; RTP_BAS=${RTP_BAS:-20000}
RTP_BIT=$((RTP_BAS + 200))
read -rp "Ofisin sabit dış IP'si [${PUBLIC_IP}]: " GIRILEN; PUBLIC_IP=${GIRILEN:-$PUBLIC_IP}
LAN_IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
LAN_NET=$(ip -4 -o addr show | awk -v ip="$LAN_IP" '$4 ~ "^"ip"/" {print $4}' | head -1)
SIP_IPS=$(dig +short A "$SIP_HOST" | grep -E '^[0-9.]+$' || true)
echo "SIP portu: $SIP_PORT | RTP: $RTP_BAS-$RTP_BIT"
echo "Dış IP: $PUBLIC_IP | Sanal makine IP: $LAN_IP ($LAN_NET) | NetGSM IP: $SIP_IPS"

cat > /etc/asterisk/pjsip.conf <<EOF
[global]
type=global
user_agent=XRE-SesTesti

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:${SIP_PORT}
external_media_address=${PUBLIC_IP}
external_signaling_address=${PUBLIC_IP}
local_net=${LAN_NET}

[netgsm-auth]
type=auth
auth_type=userpass
username=${SIP_USER}
password=${SIP_PASS}

[netgsm-kayit]
type=registration
transport=transport-udp
outbound_auth=netgsm-auth
server_uri=sip:${SIP_HOST}
client_uri=sip:${SIP_USER}@${SIP_HOST}
contact_user=${SIP_USER}
retry_interval=30
expiration=300

[netgsm-aor]
type=aor
contact=sip:${SIP_HOST}

[netgsm]
type=endpoint
transport=transport-udp
context=gelen
disallow=all
allow=alaw,ulaw
outbound_auth=netgsm-auth
aors=netgsm-aor
from_user=${SIP_USER}
from_domain=${SIP_HOST}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733

[netgsm-tani]
type=identify
endpoint=netgsm
match=${SIP_HOST}
EOF
chmod 640 /etc/asterisk/pjsip.conf; chown root:asterisk /etc/asterisk/pjsip.conf

cat > /etc/asterisk/rtp.conf <<EOF
[general]
rtpstart=${RTP_BAS}
rtpend=${RTP_BIT}
rtcpinterval=5000
EOF

# Eski chan_sip modülü de 5060'ı dinlemeye çalışır; kapat (yalnızca PJSIP)
grep -q '^noload => chan_sip.so' /etc/asterisk/modules.conf || sed -i '/^\[modules\]/a noload => chan_sip.so' /etc/asterisk/modules.conf

mkdir -p /var/spool/asterisk/test && chown asterisk:asterisk /var/spool/asterisk/test
cat > /etc/asterisk/extensions.conf <<'EOF'
[general]
static=yes
writeprotect=yes

[gelen]
exten => s,1,Goto(test,1)
exten => _X.,1,Goto(test,1)
exten => _+X.,1,Goto(test,1)
exten => test,1,Answer()
 same => n,Set(CHANNEL(hangup_handler_push)=kalite,s,1)
 same => n,MixMonitor(/var/spool/asterisk/test/${STRFTIME(,,%Y%m%d-%H%M%S)}-${CALLERID(num)}.wav)
 same => n,Playback(demo-echotest)
 same => n,Echo()
 same => n,Hangup()

[kalite]
exten => s,1,System(echo "${STRFTIME(,,%F %T)}|${CALLERID(num)}|${CDR(billsec)}|${CHANNEL(rtpqos,audio,all)}" >> /var/log/asterisk/ses_kalitesi.log)
 same => n,Return()
EOF

# Güvenlik: SIP portu yalnızca NetGSM'e açık, ses portları açık
ufw --force reset >/dev/null
ufw default deny incoming; ufw default allow outgoing
ufw allow 22/tcp
for ip in $SIP_IPS; do ufw allow from "$ip" to any port "$SIP_PORT" proto udp; done
ufw allow "${RTP_BAS}:${RTP_BIT}/udp"
ufw --force enable

systemctl enable asterisk >/dev/null 2>&1 || true
systemctl restart asterisk
sleep 6
echo
echo "== Kayıt durumu (Registered görmelisiniz) =="
asterisk -rx "pjsip show registrations" || true
echo
echo "Kurulum bitti."
echo " - Gelen test: NetSantral'da bir numarayı / yönlendirmeyi bu test dahilisine verin ve arayın."
echo " - Giden test: bash ara.sh 05XXXXXXXXX"
echo " - Sonuçlar:   bash kalite.sh"

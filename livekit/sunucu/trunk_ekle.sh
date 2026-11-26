#!/usr/bin/env bash
# NetGSM SIP trunk'ını (Vapi'nin kullandığı hat) bu sunucuya tanıtır. Vapi'ye ve gelen aramalara DOKUNMAZ;
# yalnızca bu sunucunun aynı trunk üzerinden arama yapabilmesini sağlar.
#   sudo bash /opt/xre-ai/trunk_ekle.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
PJSIP=/etc/asterisk/pjsip.conf
read -rp "SIP sunucusu [sip8.netsantral.com]: " HOST; HOST=${HOST:-sip8.netsantral.com}
read -rp "Trunk kullanıcı adı [8503465993]: " KUL; KUL=${KUL:-8503465993}
read -rsp "Trunk şifresi (ekranda görünmez): " SIFRE; echo
[ -n "$SIFRE" ] || { echo "Şifre boş olamaz."; exit 1; }
cp "$PJSIP" "$PJSIP.trunk-oncesi"
sed -i '/^; ---- NETGSM TRUNK BASLANGIC ----$/,/^; ---- NETGSM TRUNK BITIS ----$/d' "$PJSIP"
cat >> "$PJSIP" <<EOT
; ---- NETGSM TRUNK BASLANGIC ----
[netgsm-trunk-auth]
type=auth
auth_type=userpass
username=${KUL}
password=${SIFRE}

[netgsm-trunk-aor]
type=aor
contact=sip:${HOST}

[netgsm-trunk]
type=endpoint
transport=transport-udp
context=gelen
disallow=all
allow=alaw,ulaw
outbound_auth=netgsm-trunk-auth
aors=netgsm-trunk-aor
from_domain=${HOST}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733
send_pai=yes
trust_id_outbound=yes
; ---- NETGSM TRUNK BITIS ----
EOT
asterisk -rx "module reload res_pjsip.so" >/dev/null
sleep 2
asterisk -rx "pjsip show endpoint netgsm-trunk" | grep -qE "Endpoint: +netgsm-trunk" && echo "✓ Trunk tanımlandı." || { echo "✗ Trunk yüklenemedi; eski ayar geri alınıyor."; cp "$PJSIP.trunk-oncesi" "$PJSIP"; asterisk -rx "module reload res_pjsip.so" >/dev/null; exit 1; }
echo "Şimdi deneyin:  sudo bash /opt/xre-ai/trunk_dene.sh <görünecek-numara> <aranacak-numara>"
echo "Örnek:          sudo bash /opt/xre-ai/trunk_dene.sh 5337437116 05061288930"

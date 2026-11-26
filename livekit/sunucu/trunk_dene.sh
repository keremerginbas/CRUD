#!/usr/bin/env bash
# NetGSM trunk'ından deneme araması (yapay zekâ yok; açınca söylediğinizi geri yankılar).
# Amaç: müşteride hangi numaranın göründüğünü ve NetGSM'in aramayı kabul edip etmediğini görmek.
#   sudo bash trunk_dene.sh <görünecek-numara> <aranacak-numara>
#   örnek: sudo bash trunk_dene.sh 5337437116 05061288930
set -euo pipefail
ARAYAN=$(echo "${1:?Kullanım: trunk_dene.sh <görünecek-numara> <aranacak-numara>}" | tr -cd '0-9')
HEDEF=$(echo "${2:?Kullanım: trunk_dene.sh <görünecek-numara> <aranacak-numara>}" | tr -cd '0-9')
SUNUCU=$(awk -F'sip:' '/^contact=sip:/{print $2; exit}' /etc/asterisk/pjsip.conf)
IP=$(dig +short A "$SUNUCU" | grep -E '^[0-9.]+$' | head -1)
echo "Görünecek numara: $ARAYAN → aranan: $HEDEF   (NetGSM: $SUNUCU $IP)"
( timeout 25 tcpdump -ni any -A -s0 udp and host "$IP" 2>/dev/null | grep --line-buffered -E "^SIP/2.0 [0-9]{3}|^INVITE sip:" | awk '!g[$0]++' | sed 's/^/  NetGSM ile: /' ) &
sleep 1
asterisk -rx "channel originate Local/${ARAYAN}*${HEDEF}@trunk-dene extension test@gelen" >/dev/null
echo "Arama gönderildi. Telefon çalarsa açın; ekranda görünen numarayı not edin."
wait
echo
echo "Yorum: '200 OK' = arama kabul edildi · '403/401' = NetGSM bu şifreyi ya da bu numarayı kabul etmedi · '404/484' = numara biçimi yanlış"

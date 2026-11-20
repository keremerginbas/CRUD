#!/usr/bin/env bash
# Giden test araması: sunucu verilen numarayı NetGSM üzerinden arar, açınca "echo" testi başlar.
# Kullanım: sudo bash ara.sh 05XXXXXXXXX
set -euo pipefail
NUMARA=${1:?Kullanım: bash ara.sh 05XXXXXXXXX}
NUMARA=$(echo "$NUMARA" | tr -cd '0-9')
asterisk -rx "channel originate PJSIP/${NUMARA}@netgsm extension test@gelen"
echo "Arama başlatıldı: $NUMARA — telefonu açın, 1-2 dakika konuşun, sonra kapatın."

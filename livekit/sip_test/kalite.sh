#!/usr/bin/env bash
# Test aramalarının ses kalitesi özeti (paket kaybı ve jitter).
# Kullanım: sudo bash kalite.sh
LOG=/var/log/asterisk/ses_kalitesi.log
[ -s "$LOG" ] || { echo "Henüz kayıtlı arama yok ($LOG)."; exit 0; }
printf "%-19s %-14s %6s %9s %9s %9s %9s %8s\n" "ZAMAN" "NUMARA" "SÜRE" "GELEN%" "GİDEN%" "JIT-GEL" "JIT-GİD" "RTT(ms)"
while IFS='|' read -r zaman numara sure qos; do
  al() { echo "$qos" | tr ';' '\n' | awk -F= -v k="$1" '$1==k{print $2}'; }
  lp=$(al lp); rxc=$(al rxcount); rlp=$(al rlp); txc=$(al txcount)
  rxj=$(al rxjitter); txj=$(al txjitter); rtt=$(al rtt)
  yuzde() { awk -v k="${1:-0}" -v n="${2:-0}" 'BEGIN{t=k+n; if(t<=0) print "-"; else printf "%.2f", 100*k/t}'; }
  ms() { awk -v v="${1:-0}" 'BEGIN{ if(v<1) printf "%.1f", v*1000; else printf "%.1f", v }'; }
  printf "%-19s %-14s %6s %9s %9s %9s %9s %8s\n" "$zaman" "$numara" "${sure:-?}" \
    "$(yuzde "$lp" "$rxc")" "$(yuzde "$rlp" "$txc")" "$(ms "$rxj")" "$(ms "$txj")" "$(ms "$rtt")"
done < "$LOG"
echo
echo "GELEN% = NetGSM'den sunucuya gelen seste kayıp, GİDEN% = sunucudan NetGSM'e giden seste kayıp."
echo "Hedef: kayıp %1'in altında, jitter 30 ms'nin altında."
echo "Kayıtlar: /var/spool/asterisk/test/  (bilgisayarınıza alıp dinleyebilirsiniz)"

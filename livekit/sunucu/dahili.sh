#!/usr/bin/env bash
# Sunucunun NetGSM'deki 113 numaralı dahiliye bağlantısını kapatır ya da yeniden açar.
# O dahili aslında satış ekibinin (Bitrix) hattı; yapay zekâ aramaları numaraların kendi trunk'larından çıkmalı.
#   sudo bash /opt/xre-ai/dahili.sh durum   → bağlı mı, göster
#   sudo bash /opt/xre-ai/dahili.sh kapat   → dahiliden çık (NetGSM'e "kaydı sil" der, yeniden bağlanmaz)
#   sudo bash /opt/xre-ai/dahili.sh ac      → yeniden bağlan
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
PJSIP=/etc/asterisk/pjsip.conf
durum() { asterisk -rx "pjsip show registrations" 2>&1 | grep -E "netgsm-kayit" | sed 's/^/  /' || echo "  (dahili kaydı tanımlı değil ya da kapalı)"; }
case "${1:-durum}" in
  durum) echo "Dahili (113) bağlantısı:"; durum ;;
  kapat)
    grep -q '^\[netgsm-kayit\]' "$PJSIP" || { echo "Dahili kaydı zaten kapalı."; exit 0; }
    asterisk -rx "pjsip send unregister netgsm-kayit" >/dev/null 2>&1 || true; sleep 3
    cp "$PJSIP" "$PJSIP.dahili-oncesi"
    # kayıt bölümünü yorum satırına çevir ([netgsm-kayit] başlığından sonraki boş satıra kadar)
    awk '/^\[netgsm-kayit\]/{k=1} k&&/^$/{k=0} {print (k ? ";DAHILI-KAPALI " : "") $0}' "$PJSIP.dahili-oncesi" > "$PJSIP"
    asterisk -rx "module reload res_pjsip_outbound_registration.so" >/dev/null 2>&1 || true
    asterisk -rx "module reload res_pjsip.so" >/dev/null; sleep 2
    echo "✓ Sunucu 113 numaralı dahiliden çıktı. Dahili artık yalnızca satış ekibinin."
    echo "  Not: 'hat: dahili' olan numaralardan yapay zekâ araması artık ÇIKMAZ; numaralar trunk hattında olmalı."
    durum ;;
  ac)
    grep -q '^;DAHILI-KAPALI ' "$PJSIP" || { echo "Dahili kaydı zaten açık."; durum; exit 0; }
    sed -i 's/^;DAHILI-KAPALI //' "$PJSIP"
    asterisk -rx "module reload res_pjsip.so" >/dev/null; asterisk -rx "module reload res_pjsip_outbound_registration.so" >/dev/null 2>&1 || true; sleep 5
    echo "✓ Dahili kaydı yeniden açıldı."; durum ;;
  *) echo "Kullanım: dahili.sh durum | kapat | ac"; exit 1 ;;
esac

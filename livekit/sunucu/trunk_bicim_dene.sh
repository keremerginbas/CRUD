#!/usr/bin/env bash
# NetGSM trunk'ı "401" veriyorsa: aynı şifreyle farklı kullanıcı adı yazımlarını sırayla dener ve hangisinin
# kabul edildiğini gösterir. Asıl ayarlara dokunmaz; geçici bir deneme hattı kurar ve sonunda siler.
#   sudo bash /opt/xre-ai/trunk_bicim_dene.sh 05337437116 05061288930
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
PJSIP=/etc/asterisk/pjsip.conf; GUNLUK=/var/log/asterisk/trunk_dene.log
N=$(echo "${1:?Kullanım: trunk_bicim_dene.sh <trunk numarası> <aranacak numara>}" | tr -cd '0-9' | sed -E 's/^(90|0)//')
HEDEF=$(echo "${2:?Kullanım: trunk_bicim_dene.sh <trunk numarası> <aranacak numara>}" | tr -cd '0-9')
SIFRE=$(awk -v n="[trunk-$N-auth]" '$0==n{b=1} b&&/^password=/{sub(/^password=/,""); print; exit}' "$PJSIP")
HOST=$(awk -v n="[trunk-$N-aor]" -F'sip:' '$0==n{b=1} b&&/^contact=sip:/{print $2; exit}' "$PJSIP")
[ -n "$SIFRE" ] && [ -n "$HOST" ] || { echo "0$N için trunk tanımlı değil. Önce: sudo bash /opt/xre-ai/trunk_ekle.sh toplu"; exit 1; }
temizle() { sed -i '/^; ---- GECICI DENEME BASLANGIC ----$/,/^; ---- GECICI DENEME BITIS ----$/d' "$PJSIP"; asterisk -rx "module reload res_pjsip.so" >/dev/null 2>&1 || true; }
trap temizle EXIT
touch "$GUNLUK"; chown asterisk:asterisk "$GUNLUK" 2>/dev/null || chmod 666 "$GUNLUK"
echo "0$N trunk'ı için kullanıcı adı yazımları deneniyor (her biri yaklaşık 10 saniye). Telefonunuz çalarsa AÇMAYIN, çalması yeterli."
echo
SONUC_VAR=0
# her satır: kimlik kullanıcı adı | From kullanıcı adı | aranan numara biçimi
for D in "90$N|90$N|$HEDEF" "0$N|0$N|$HEDEF" "$N|$N|$HEDEF" "+90$N|+90$N|+9${HEDEF}" "+90$N|+90$N|9${HEDEF}" "+90$N|$N|$HEDEF"; do
  IFS='|' read -r KUL FROM ARANAN <<< "$D"
  sed -i '/^; ---- GECICI DENEME BASLANGIC ----$/,/^; ---- GECICI DENEME BITIS ----$/d' "$PJSIP"
  cat >> "$PJSIP" <<EOT
; ---- GECICI DENEME BASLANGIC ----
[trunk-0000000001-auth]
type=auth
auth_type=userpass
username=${KUL}
password=${SIFRE}

[trunk-0000000001-aor]
type=aor
contact=sip:${HOST}

[trunk-0000000001]
type=endpoint
transport=transport-udp
context=gelen
disallow=all
allow=alaw,ulaw
outbound_auth=trunk-0000000001-auth
aors=trunk-0000000001-aor
from_domain=${HOST}
from_user=${FROM}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
; ---- GECICI DENEME BITIS ----
EOT
  asterisk -rx "module reload res_pjsip.so" >/dev/null; sleep 2
  ONCE=$(wc -l < "$GUNLUK")
  asterisk -rx "channel originate Local/0000000001*${ARANAN}@trunk-dene extension test@gelen" >/dev/null
  SON=""
  for i in $(seq 1 8); do
    sleep 1; SON=$(tail -n +"$((ONCE + 1))" "$GUNLUK" | grep "ACILMADI" | tail -1 || true); [ -n "$SON" ] && break
  done
  if [ -n "$SON" ]; then
    printf '  ✗ kullanıcı adı %-15s From %-15s aranan %-14s → %s\n' "$KUL" "$FROM" "$ARANAN" "$(echo "$SON" | cut -d'|' -f4-)"
  else
    printf '  ✓ kullanıcı adı %-15s From %-15s aranan %-14s → REDDEDİLMEDİ (telefon çalıyor olmalı)\n' "$KUL" "$FROM" "$ARANAN"; SONUC_VAR=1
    # yalnızca bu denemenin kanallarını kapat (süren gerçek görüşmelere dokunma)
    for K in $(asterisk -rx "core show channels concise" 2>/dev/null | grep "0000000001" | cut -d'!' -f1 || true); do asterisk -rx "channel request hangup $K" >/dev/null 2>&1 || true; done
    break
  fi
done
echo
[ "$SONUC_VAR" = 1 ] && echo "Çalışan yazım bulundu. Bu çıktıyı gönderin; bütün trunk'ları bu yazıma çevireceğim." || echo "Hiçbir yazım kabul edilmedi: sorun kullanıcı adı biçiminde değil, NetGSM tarafındaki yetkilendirmede. Bu çıktıyı gönderin."

#!/usr/bin/env bash
# NetGSM trunk'ı aramayı kabul edip sonra "500" veriyorsa nedenini daraltır: aranan numarayı farklı
# yazımlarla (90506…, 0506…, 506…) ve ek kimlik başlığı açık/kapalı olarak dener.
# NetGSM'in gerçek cevabına bakar. Asıl ayarlara dokunmaz; geçici deneme hattını sonunda siler.
#   sudo bash /opt/xre-ai/trunk_bicim_dene.sh 05337437116 05061288930
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
PJSIP=/etc/asterisk/pjsip.conf
N=$(echo "${1:?Kullanım: trunk_bicim_dene.sh <trunk numarası> <aranacak numara>}" | tr -cd '0-9' | sed -E 's/^(90|0)//')
HEDEF=$(echo "${2:?Kullanım: trunk_bicim_dene.sh <trunk numarası> <aranacak numara>}" | tr -cd '0-9')
SIFRE=$(awk -v n="[trunk-$N-auth]" '$0==n{b=1} b&&/^password=/{sub(/^password=/,""); print; exit}' "$PJSIP")
HOST=$(awk -v n="[trunk-$N-aor]" -F'sip:' '$0==n{b=1} b&&/^contact=sip:/{print $2; exit}' "$PJSIP")
[ -n "$SIFRE" ] && [ -n "$HOST" ] || { echo "0$N için trunk tanımlı değil. Önce: sudo bash /opt/xre-ai/trunk_ekle.sh toplu"; exit 1; }
IP=$(dig +short A "$HOST" | grep -E '^[0-9.]+$' | head -1)
DIS=$(awk '/^\[transport-udp\]/{b=1} b&&/^external_signaling_address=/{sub(/^[^=]*=/,""); print; exit}' "$PJSIP")
YEREL=$(awk '/^\[transport-udp\]/{b=1} b&&/^local_net=/{sub(/^[^=]*=/,""); print; exit}' "$PJSIP")
IZ=$(mktemp)
temizle() { rm -f "$IZ"; sed -i '/^; ---- GECICI DENEME BASLANGIC ----$/,/^; ---- GECICI DENEME BITIS ----$/d' "$PJSIP"; asterisk -rx "module reload res_pjsip.so" >/dev/null 2>&1 || true; }
trap temizle EXIT
KULLANICI=$(awk -v n="[trunk-$N-auth]" '$0==n{b=1} b&&/^username=/{sub(/^username=/,""); print; exit}' "$PJSIP")
H10=$(echo "$HEDEF" | sed -E 's/^(90|0)//')
echo "0$N trunk'ı (kullanıcı adı $KULLANICI) farklı numara yazımlarıyla deneniyor (her deneme en çok 35 saniye)."
echo "Telefonunuz çalarsa AÇMAYIN; çalması yeterli. Çalan denemede betik kendiliğinden kapatır."
echo
BULUNDU=""
# her satır: aranan numaranın yazımı | arayan kimliği ek başlığı (P-Asserted-Identity) gönderilsin mi
for D in "0$H10|hayir" "+90$H10|hayir" "$H10|hayir"; do
  IFS='|' read -r ARANAN PAI <<< "$D"
  TASIMA=transport-udp; KUL=$KULLANICI
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
transport=${TASIMA}
context=gelen
disallow=all
allow=alaw,ulaw
outbound_auth=trunk-0000000001-auth
aors=trunk-0000000001-aor
from_domain=${HOST}
from_user=${KUL}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
send_pai=$([ "$PAI" = evet ] && echo yes || echo no)
; ---- GECICI DENEME BITIS ----
EOT
  asterisk -rx "module reload res_pjsip.so" >/dev/null; sleep 3
  : > "$IZ"
  ( timeout 32 tcpdump -ni any -A -s0 udp and host "$IP" > "$IZ" 2>/dev/null || true ) &
  sleep 1
  asterisk -rx "channel originate Local/0000000001*${ARANAN}@trunk-dene extension test@gelen" >/dev/null
  wait
  for K in $(asterisk -rx "core show channels concise" 2>/dev/null | grep "0000000001" | cut -d'!' -f1 || true); do asterisk -rx "channel request hangup $K" >/dev/null 2>&1 || true; done
  CEVAP=$(python3 - "$IZ" "$ARANAN" <<'PY'
import re, sys
ham = open(sys.argv[1], encoding="utf-8", errors="ignore").read(); hedef = sys.argv[2]
paketler = re.split(r"\n(?=\d\d:\d\d:\d\d\.\d+ )", ham)
def baslik(p, ad):
    m = re.search(r"^" + ad + r"\s*:\s*(.+)$", p, re.M | re.I); return m.group(1).strip() if m else ""
idler = {baslik(p, "Call-ID") for p in paketler if re.search(r"INVITE sip:" + re.escape(hedef) + "@", p)} - {""}
kodlar, port = [], ""
for p in paketler:
    if baslik(p, "Call-ID") not in idler: continue
    m = re.search(r"SIP/2\.0 (\d{3}) ([^\r\n]*)", p)
    if m and "INVITE" in baslik(p, "CSeq"):
        neden = re.search(r"cause=(\d+)", baslik(p, "Reason"))
        kodlar.append(m.group(1) + " " + m.group(2).strip() + (" (cause=" + neden.group(1) + ")" if neden else ""))
    v = re.search(r"^Via:.*?;rport=(\d+)", p, re.M)
    if v: port = v.group(1)
print(("|".join(dict.fromkeys(kodlar)) or "CEVAP YOK") + "#" + port)
PY
)
  KODLAR=${CEVAP%%#*}
  if echo "$KODLAR" | grep -qE "(^|\|)(180|200) "; then
    printf '  ✓ aranan %-14s ek kimlik başlığı: %-5s → %s\n' "$ARANAN" "$PAI" "$KODLAR"; BULUNDU="$ARANAN|$PAI"; break
  else
    printf '  ✗ aranan %-14s ek kimlik başlığı: %-5s → %s\n' "$ARANAN" "$PAI" "$KODLAR"
  fi
done
echo
[ -n "$BULUNDU" ] && echo "ÇALIŞAN AYAR BULUNDU. Bu çıktıyı gönderin." || echo "Hiçbiri kabul edilmedi. Bu çıktıyı gönderin."

#!/usr/bin/env bash
# NetGSM trunk'ından deneme araması (yapay zekâ yok; açınca söylediğinizi geri yankılar).
# Amaç: müşteride hangi numaranın göründüğünü ve NetGSM'in aramayı kabul edip etmediğini görmek.
#   sudo bash trunk_dene.sh <görünecek-numara> <aranacak-numara>
#   örnek: sudo bash trunk_dene.sh 5337437116 05061288930
set -euo pipefail
trunk_var() { local c; c=$(asterisk -rx "pjsip show endpoint trunk-$1" 2>&1 || true); grep -qE "Endpoint: +trunk-$1" <<< "$c"; }
ARAYAN=$(echo "${1:?Kullanım: trunk_dene.sh <görünecek-numara> <aranacak-numara>}" | tr -cd '0-9' | sed -E 's/^(90|0)//')
trunk_var "$ARAYAN" || { echo "0$ARAYAN için trunk tanımlı değil. Önce: sudo bash /opt/xre-ai/trunk_ekle.sh"; exit 1; }
HEDEF=$(echo "${2:?Kullanım: trunk_dene.sh <görünecek-numara> <aranacak-numara>}" | tr -cd '0-9')
SUNUCU=$(awk -v n="[trunk-$ARAYAN-aor]" -F'sip:' '$0==n{b=1} b&&/^contact=sip:/{print $2; exit}' /etc/asterisk/pjsip.conf)
IP=$(dig +short A "$SUNUCU" | grep -E '^[0-9.]+$' | head -1)
echo "Görünecek numara: $ARAYAN → aranan: $HEDEF   (NetGSM: $SUNUCU $IP)"
IZ=$(mktemp); trap 'rm -f "$IZ"' EXIT
( timeout 25 tcpdump -ni any -A -s0 udp and host "$IP" > "$IZ" 2>/dev/null || true ) &
sleep 1
GUNLUK=/var/log/asterisk/trunk_dene.log; touch "$GUNLUK"; chown asterisk:asterisk "$GUNLUK" 2>/dev/null || chmod 666 "$GUNLUK"; ONCE=$(wc -l < "$GUNLUK")
asterisk -rx "channel originate Local/${ARAYAN}*${HEDEF}@trunk-dene extension test@gelen" >/dev/null
echo "Arama gönderildi. Telefon çalarsa açın; ekranda görünen numarayı not edin."
wait
echo
echo "NetGSM ile konuşma (sırayla; yalnızca bu aramanın satırları):"
python3 - "$IZ" "$HEDEF" <<'PY'
import re, sys
ham = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
hedef = sys.argv[2]
paketler = re.split(r"\n(?=\d\d:\d\d:\d\d\.\d+ )", ham)
cagri_idleri, satirlar = set(), []
def baslik(p, ad):
    m = re.search(r"^" + ad + r"\s*:\s*(.+)$", p, re.M | re.I)
    return m.group(1).strip() if m else ""
for p in paketler:  # önce bu aramaya ait Call-ID'leri bul (hedef numaraya giden INVITE)
    if re.search(r"INVITE sip:" + re.escape(hedef) + "@", p):
        cagri_idleri.add(baslik(p, "Call-ID"))
for p in paketler:
    if baslik(p, "Call-ID") not in cagri_idleri or not cagri_idleri:
        continue
    yon = "→ NetGSM" if re.search(r" Out |> 185\.|\.5070 > ", p.split("\n")[0]) else "← NetGSM"
    ilk = re.search(r"(SIP/2\.0 \d{3} [^\r\n]*|(?:INVITE|ACK|BYE|CANCEL|PRACK) sip:[^ \r\n]+)", p)
    if not ilk:
        continue
    ek = []
    if "Authorization:" in p:
        m = re.search(r'username="([^"]*)".*?realm="([^"]*)"', p, re.S)
        ek.append("şifreli istek (kullanıcı %s, alan %s)" % (m.group(1), m.group(2)) if m else "şifreli istek")
    for ad in ("WWW-Authenticate", "Proxy-Authenticate"):
        v = baslik(p, ad)
        if v:
            m = re.search(r'realm="([^"]*)"', v); ek.append("şifre istiyor (alan %s)" % (m.group(1) if m else "?"))
    for ad in ("Reason", "Warning", "X-Reason"):
        if baslik(p, ad): ek.append(ad + ": " + baslik(p, ad)[:120])
    if ilk.group(1).startswith("INVITE"):
        ek.append("From: " + re.sub(r";tag=.*", "", baslik(p, "From"))[:80])
    satirlar.append(f"  {yon}  {ilk.group(1).strip()[:70]}" + ("   [" + " · ".join(ek) + "]" if ek else ""))
print("\n".join(satirlar) if satirlar else "  (bu aramaya ait paket görülmedi: arama sunucudan hiç çıkmamış)")
PY
echo
echo "Santralin kaydı:"
SATIRLAR=$(tail -n +"$((ONCE + 1))" "$GUNLUK")
if [ -z "$SATIRLAR" ]; then echo "  (santral kayıt düşmedi; yukarıdaki 'NetGSM ile' satırlarına bakın)"
elif ! grep -q "ACILMADI" <<< "$SATIRLAR"; then echo "  Arama NetGSM'e gönderildi ve 'açılmadı' kaydı düşmedi: telefon çaldıysa/açtıysanız hat çalışıyor demektir."
else sed 's/^/  /' <<< "$SATIRLAR"; fi
echo
echo "Yorum: '200 OK' = arama kabul edildi · '403/401' = NetGSM bu şifreyi ya da bu numarayı kabul etmedi · '404/484' = numara biçimi yanlış"

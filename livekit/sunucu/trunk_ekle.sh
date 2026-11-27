#!/usr/bin/env bash
# NetGSM SIP trunk'larını bu sunucuya tanıtır. NetGSM'de her GSM numarasının AYRI trunk'ı (kullanıcı adı + şifre) vardır;
# bu betik her numara için bir kez çalıştırılır. Vapi'ye ve gelen aramalara DOKUNMAZ.
#   sudo bash /opt/xre-ai/trunk_ekle.sh            → sırayla sorar; başka numara ekleyip eklemeyeceğinizi de sorar
#   sudo bash /opt/xre-ai/trunk_ekle.sh toplu      → NetGSM'in gönderdiği listeyi (e-posta metnini) yapıştırırsınız, hepsini ekler
#   sudo bash /opt/xre-ai/trunk_ekle.sh liste      → tanımlı trunk'ları gösterir
#   sudo bash /opt/xre-ai/trunk_ekle.sh sil 5337437116
set -euo pipefail
trunk_var() { local c; c=$(asterisk -rx "pjsip show endpoint trunk-$1" 2>&1 || true); grep -qE "Endpoint: +trunk-$1" <<< "$c"; }
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
PJSIP=/etc/asterisk/pjsip.conf
HEDEF=/opt/xre-ai
rakam() { echo "$1" | tr -cd '0-9' | sed -E 's/^(90|0)//'; }          # 0533.. / +90533.. → 533..
yukle() { asterisk -rx "module reload res_pjsip.so" >/dev/null; sleep 2; }

if [ "${1:-}" = liste ]; then
  for N in $(grep -oE '^; ---- TRUNK [0-9]+ BASLANGIC' "$PJSIP" | awk '{print $4}' || true); do
    trunk_var "$N" && echo "  ✓ 0$N yüklü" || echo "  ✗ 0$N dosyada var ama santrale yüklenmemiş"
  done
  grep -q '^; ---- TRUNK ' "$PJSIP" || echo "  (tanımlı trunk yok)"
  exit 0
fi
if [ "${1:-}" = sil ]; then
  N=$(rakam "${2:?Kullanım: trunk_ekle.sh sil <numara>}")
  sed -i "/^; ---- TRUNK $N BASLANGIC ----\$/,/^; ---- TRUNK $N BITIS ----\$/d" "$PJSIP"; yukle; echo "0$N trunk'ı silindi."; exit 0
fi

ekle() {  # $1 numara (533...), $2 sunucu, $3 kullanıcı, $4 şifre
  local N=$1 HOST=$2 KUL=$3 SIFRE=$4
  cp "$PJSIP" "$PJSIP.trunk-oncesi"
  sed -i "/^; ---- TRUNK $N BASLANGIC ----\$/,/^; ---- TRUNK $N BITIS ----\$/d" "$PJSIP"
  cat >> "$PJSIP" <<EOT
; ---- TRUNK $N BASLANGIC ----
[trunk-$N-auth]
type=auth
auth_type=userpass
username=${KUL}
password=${SIFRE}

[trunk-$N-aor]
type=aor
contact=sip:${HOST}

[trunk-$N]
type=endpoint
transport=transport-udp
context=gelen
disallow=all
allow=alaw,ulaw
outbound_auth=trunk-$N-auth
aors=trunk-$N-aor
from_domain=${HOST}
from_user=${KUL}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
dtmf_mode=rfc4733
send_pai=yes
trust_id_outbound=yes
; ---- TRUNK $N BITIS ----
EOT
  [ "${SESSIZ:-}" = 1 ] || yukle
  if [ "${SESSIZ:-}" = 1 ] || trunk_var "$N"; then
    echo "✓ 0$N için trunk tanımlandı."
  else
    echo "✗ Trunk yüklenemedi; eski ayar geri alınıyor."; cp "$PJSIP.trunk-oncesi" "$PJSIP"; yukle; return 1
  fi
  # Paneldeki numara kaydını bu trunk'tan çıkacak şekilde işaretle (hat: trunk)
  python3 - "$HEDEF/numaralar.yaml" "$N" <<'PY' || echo "  (numaralar.yaml güncellenemedi: panelde Numaralar sayfasından bu numaranın hattını 'trunk' yapın)"
import re, sys, yaml
yol, n = sys.argv[1], sys.argv[2]
d = yaml.safe_load(open(yol, encoding="utf-8")) or {}
bulundu = False
for k in d.get("numaralar") or []:
    if re.sub(r"\D", "", str(k.get("numara") or "")).endswith(n):
        k["hat"] = "trunk"; bulundu = True
if bulundu:
    yaml.safe_dump(d, open(yol, "w", encoding="utf-8"), allow_unicode=True, sort_keys=False)
    print("  Panelde bu numara artık kendi trunk'ından arayacak.")
else:
    print("  Uyarı: bu numara panelde kayıtlı değil. Panel → Numaralar'dan ekleyin (hat: trunk).")
PY
}

if [ "${1:-}" = toplu ]; then
  echo "NetGSM'in gönderdiği listeyi (\"Kullanıcı adı : +90... / Şifre : ...\" satırlarını) buraya yapıştırın."
  echo "Yapıştırdıktan sonra Enter'a, ardından Ctrl ve D tuşlarına birlikte basın."
  G=$(mktemp); trap 'rm -f "$G" "$G.c"' EXIT; chmod 600 "$G"
  cat > "$G"
  # Metinden (kullanıcı adı, şifre) çiftlerini çıkar; şifreleri ekrana yazma
  python3 - "$G" > "$G.c" <<'PY'
import re, sys
t = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
host = (re.search(r"SIP Sunucu adresi\s*:\s*([A-Za-z0-9.-]+)", t) or [None, "sip8.netsantral.com"])[1]
for kul, sifre in re.findall(r"Kullan[ıi]c[ıi]\s*ad[ıi]\s*:\s*(\+?\d{10,13})\s*[\r\n ]+\s*[ŞS]ifre\s*:\s*(\S+)", t):
    print(host, kul, sifre)
PY
  ADET=$(wc -l < "$G.c")
  [ "$ADET" -gt 0 ] || { echo "Listede kullanıcı adı / şifre çifti bulunamadı."; exit 1; }
  echo "$ADET numara bulundu, ekleniyor..."
  cp "$PJSIP" "$PJSIP.toplu-oncesi"
  while read -r HOST KUL SIFRE; do
    N=$(rakam "$KUL"); [ ${#N} -eq 10 ] || { echo "  ! $KUL atlandı (numara 10 haneli değil)"; continue; }
    SESSIZ=1 ekle "$N" "$HOST" "$KUL" "$SIFRE" || true
  done < "$G.c"
  yukle
  TAMAM=0
  while read -r HOST KUL SIFRE; do
    N=$(rakam "$KUL"); trunk_var "$N" && TAMAM=$((TAMAM + 1)) || echo "  ✗ 0$N yüklenemedi"
  done < "$G.c"
  echo "$TAMAM / $ADET trunk yüklendi."
  echo "Denemek için:  sudo bash /opt/xre-ai/trunk_dene.sh 05337437116 <kendi cep numaranız>"
  exit 0
fi

while true; do
  read -rp "GSM numarası (müşteride görünecek, ör. 05337437116): " NUM; N=$(rakam "$NUM")
  [ ${#N} -eq 10 ] || { echo "Numara 10 haneli olmalı (533...)."; continue; }
  read -rp "SIP sunucusu [sip8.netsantral.com]: " HOST; HOST=${HOST:-sip8.netsantral.com}
  read -rp "Trunk kullanıcı adı (NetGSM'in verdiği): " KUL
  read -rsp "Trunk şifresi (ekranda görünmez): " SIFRE; echo
  if [ -z "$KUL" ] || [ -z "$SIFRE" ]; then echo "Kullanıcı adı ve şifre boş olamaz."; continue; fi
  ekle "$N" "$HOST" "$KUL" "$SIFRE" || true
  echo "  Denemek için:  sudo bash /opt/xre-ai/trunk_dene.sh 0$N <kendi cep numaranız>"
  read -rp "Başka numara eklenecek mi? [e/H]: " DEVAM
  case "$DEVAM" in e|E|evet|Evet) ;; *) break ;; esac
done
echo "Tanımlı trunk'lar:"; bash "$0" liste

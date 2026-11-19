#!/usr/bin/env bash
# Netsantral dahililerini topluca santrale bağlar: her danışmanın 0533'ü bir dahilinin "varsayılan giden numarası"
# olduğu için her dahili ayrı bir bağlantıdır (ad: d<dahili>). Santral konteynerinde (CT 150) root olarak:
#   /opt/santral/pbx/trunks-bulk.sh /root/dahililer.csv
# CSV (başlık satırı yok, # ile başlayan satırlar atlanır):
#   dahili;kullanici_adi;sifre;numara
#   101;101-8503465993;GizliSifre;5337435922
# Sunucu NETSANTRAL_HOST ile değiştirilebilir (varsayılan sip8.netsantral.com).
# Dosyada şifreler var: sadece bu sunucuda tutun (chmod 600), işiniz bitince silin; depoya ya da sohbete koymayın.
# Ardından uygulamada hatların bağlantısını yazmak için ekrana basılan hatlar listesini kullanın.
set -euo pipefail
FILE="${1:-}"
[[ -f "$FILE" ]] || { echo "Kullanım: $0 dahililer.csv"; exit 1; }
HOST="${NETSANTRAL_HOST:-sip8.netsantral.com}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OK=0; BAD=0
MAP="$(mktemp)"; trap 'rm -f "$MAP"' EXIT
while IFS=';' read -r EXT USER PASS NUM _ || [[ -n "${EXT:-}" ]]; do
  EXT="$(printf '%s' "$EXT" | tr -cd '0-9')"
  [[ -z "$EXT" || "$EXT" == \#* ]] && continue
  NUM="$(printf '%s' "$NUM" | tr -cd '0-9')"; NUM="${NUM: -10}"
  USER="$(printf '%s' "$USER" | tr -d '\r[:space:]')"; PASS="$(printf '%s' "$PASS" | tr -d '\r')"
  if [[ ! "$NUM" =~ ^5[0-9]{9}$ || -z "$USER" || -z "$PASS" ]]; then echo "  ✗ atlandı (eksik/geçersiz satır): dahili $EXT"; BAD=$((BAD+1)); continue; fi
  # trunk.sh'nin sorularına cevaplar: Netgsm, sunucu, şifreli kayıt, ek IP yok, numara, 1 kanal, biçim 10, kullanıcı, şifre
  if printf '%s\n' 1 "$HOST" 1 "" "$NUM" 1 10 "$USER" "$PASS" | XRE_WAIT=0 "$DIR/trunk.sh" "d$EXT" >/dev/null 2>&1; then
    echo "  ✓ d$EXT → 0$NUM"; OK=$((OK+1)); echo ",0$NUM,,,,d$EXT" >> "$MAP"
  else
    echo "  ✗ d$EXT tanımlanamadı (trunk.sh d$EXT ile elle deneyin)"; BAD=$((BAD+1))
  fi
done < "$FILE"
sleep 8
echo "== $OK dahili tanımlandı, $BAD sorunlu. Kayıt durumu:"
asterisk ${ASTERISK_OPTS:-} -rx 'pjsip show registrations' | grep -E "^ *d[0-9]+-reg/" \
  | sed -E 's#^ *(d[0-9]+)-reg/[^ ]+ +[^ ]+ +([A-Za-z]+).*#   \1 \2#' || true
echo "== Uygulamaya aktarılacak hat → bağlantı listesi: /root/hat-baglanti.csv"
{ echo "dahili,numara,etiket,danisman_email,tip,baglanti"; cat "$MAP"; } > /root/hat-baglanti.csv

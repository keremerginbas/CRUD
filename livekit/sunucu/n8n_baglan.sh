#!/usr/bin/env bash
# n8n akışlarının Vapi yerine bu sunucuyu kullanabilmesi için hazırlık (bir kez çalıştırılır):
#  1) n8n'deki mevcut "Vapi" kimlik bilgisi değişmeden çalışsın diye eski Vapi anahtarını bu sunucuya da tanıtır
#  2) Sunucunun dış adresini kaydeder (ses kaydı bağlantıları bu adresle üretilir)
#  3) Vapi'deki numara kimliklerini numaralar.yaml'a işler (akışlardaki phoneNumberId'ler aynen çalışır)
#   sudo bash /opt/xre-ai/n8n_baglan.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
HEDEF=/opt/xre-ai; cd "$HEDEF"
MEVCUT=$(grep -E '^DIS_ADRES=' .env | cut -d= -f2- || true)
read -rp "Sunucunun dış adresi [${MEVCUT:-https://arama.xresoftware.com.tr}]: " ADRES; ADRES=${ADRES:-${MEVCUT:-https://arama.xresoftware.com.tr}}; ADRES=${ADRES%/}
case "$ADRES" in https://*) ;; *) echo "Adres https:// ile başlamalı."; exit 1 ;; esac
read -rsp "Vapi Private API Key (n8n'de kayıtlı olan; ekranda görünmez): " VK; echo
[ ${#VK} -ge 16 ] || { echo "Anahtar çok kısa ya da boş."; exit 1; }
sed -i '/^DIS_ADRES=/d;/^EK_API_ANAHTARLARI=/d' .env
printf 'DIS_ADRES=%s\nEK_API_ANAHTARLARI=%s\n' "$ADRES" "$VK" >> .env
chmod 600 .env

echo "Vapi'deki numara kimlikleri okunuyor..."
G=$(mktemp); trap 'rm -f "$G"' EXIT
curl -s -m 30 "https://api.vapi.ai/phone-number?limit=100" -H "Authorization: Bearer $VK" > "$G" || echo '{"message":"bağlantı kurulamadı"}' > "$G"
python3 - "$G" numaralar.yaml <<'PY'
import json, re, sys, yaml
try:
    vapi = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    vapi = {"message": "cevap okunamadı"}
if isinstance(vapi, dict):
    print("  ✗ Vapi numaraları vermedi:", str(vapi.get("message") or vapi)[:150]); sys.exit(0)
d = yaml.safe_load(open(sys.argv[2], encoding="utf-8")) or {}
son10 = lambda s: re.sub(r"\D", "", str(s or ""))[-10:]
bizim = {son10(n.get("numara")): n for n in d.get("numaralar") or []}
degisti = False
for v in sorted(vapi, key=lambda x: str(x.get("number") or "")):
    n = bizim.get(son10(v.get("number")))
    if not v.get("number"):
        continue
    if not n:
        print(f"  ! {v.get('number')} ({v.get('name') or '-'}) bu sunucuda tanımlı değil: Panel → Numaralar'dan ekleyin")
    elif n.get("vapi_id") != v.get("id"):
        n["vapi_id"] = v.get("id"); degisti = True
        print(f"  ✓ {v.get('number')} ({n.get('ad')}): Vapi kimliği işlendi")
    else:
        print(f"  = {v.get('number')} ({n.get('ad')}): zaten tanımlı")
if degisti:
    yaml.safe_dump(d, open(sys.argv[2], "w", encoding="utf-8"), allow_unicode=True, sort_keys=False)
PY
echo "Sunucu yeniden başlatılıyor..."
docker compose up -d ajan api 2>&1 | tail -2
for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:8080/saglik || true)" = 200 ] && break; sleep 2; done
ICERI=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:8080/assistant -H "Authorization: Bearer $VK" || true)
DISARI=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$ADRES/assistant" -H "Authorization: Bearer $VK" || true)
echo "Sunucu içinden deneme: $ICERI (200 olmalı)"
echo "Dış adresten deneme ($ADRES): $DISARI (200 olmalı)"
[ "$ICERI" = 200 ] && [ "$DISARI" = 200 ] && echo "✓ Hazır: n8n akışlarında https://api.vapi.ai yerine $ADRES yazılabilir." || echo "✗ Bir deneme başarısız; bu çıktıyı gönderin."

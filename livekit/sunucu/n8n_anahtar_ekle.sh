#!/usr/bin/env bash
# n8n "Geçersiz API anahtarı" (401) veriyorsa: n8n'in gönderdiği anahtarı bu sunucuya tanıtır.
# Önce n8n'de hata veren düğümü bir kez çalıştırın, SONRA (15 dakika içinde) bu komutu çalıştırın.
#   sudo bash /opt/xre-ai/n8n_anahtar_ekle.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
cd /opt/xre-ai
PY='
import asyncio, json, sys, ortak
async def main():
    r = ortak.redis_baglan(); out = []
    async for k in r.scan_iter("red-anahtar:*"):
        v = await r.get(k)
        if v: out.append(json.loads(v))
    await r.aclose()
    out.sort(key=lambda x: x["zaman"], reverse=True)
    if len(sys.argv) > 1:
        print(out[int(sys.argv[1])]["anahtar"], end="")
    else:
        for i, x in enumerate(out):
            a, z, ip, yol = x["anahtar"], x["zaman"][11:19], x["ip"], x["yol"]
            print(f"{i + 1}) {a[:4]}…{a[-4:]} ({len(a)} karakter) · {z} UTC · gelen adres {ip} · {yol}")
asyncio.run(main())
'
LISTE=$(docker compose exec -T api python -c "$PY")
if [ -z "$LISTE" ]; then
  echo "Son 15 dakikada reddedilen anahtar yok."
  echo "n8n'de hata veren düğümü (ör. 'Vapi: Asistanlar') bir kez çalıştırın, sonra bu komutu yeniden çalıştırın."
  exit 0
fi
echo "Son 15 dakikada reddedilen anahtarlar (yalnızca ilk ve son 4 karakteri gösterilir):"
echo "$LISTE"
echo
echo "Yalnızca n8n'den geldiğinden emin olduğunuz anahtarı ekleyin (saat, sizin n8n'de denediğiniz ana uymalı)."
read -rp "Eklenecek satırın numarası (vazgeçmek için Enter): " NO
[[ "$NO" =~ ^[0-9]+$ ]] || { echo "Vazgeçildi."; exit 0; }
YENI=$(docker compose exec -T api python -c "$PY" "$((NO - 1))")
[ ${#YENI} -ge 16 ] || { echo "Anahtar okunamadı."; exit 1; }
MEVCUT=$(grep -E '^EK_API_ANAHTARLARI=' .env | cut -d= -f2- || true)
case ",$MEVCUT," in *",$YENI,"*) echo "Bu anahtar zaten tanımlı." ;; *)
  sed -i '/^EK_API_ANAHTARLARI=/d' .env
  printf 'EK_API_ANAHTARLARI=%s\n' "${MEVCUT:+$MEVCUT,}$YENI" >> .env ;;
esac
docker compose up -d api 2>&1 | tail -1
for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:8080/saglik || true)" = 200 ] && break; sleep 2; done
KOD=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:8080/assistant -H "Authorization: Bearer $YENI" || true)
[ "$KOD" = 200 ] && echo "✓ Anahtar tanıtıldı. n8n'de düğümü yeniden çalıştırın." || echo "✗ Deneme $KOD döndü; bu çıktıyı gönderin."

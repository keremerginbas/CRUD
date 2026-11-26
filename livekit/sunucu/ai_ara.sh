#!/usr/bin/env bash
# Yapay zekâ deneme araması: verilen numarayı arar, görüşme bitince sonucu gösterir.
# Kullanım: sudo bash ai_ara.sh 05XXXXXXXXX [ses-id]
#   ses-id verilirse yalnızca bu arama o ElevenLabs sesiyle yapılır (sesleri karşılaştırmak için).
#   Başka asistan/numara için:  ASISTAN=motto HAT=motto-7116 sudo -E bash ai_ara.sh 05XXXXXXXXX
set -euo pipefail
HEDEF=/opt/xre-ai
NUMARA=${1:?Kullanım: sudo bash ai_ara.sh 05XXXXXXXXX [ses-id]}
SES=${2:-}
ASISTAN=${ASISTAN:-test}
HAT=${HAT:-}
SES_JSON=""; [ -n "$SES" ] && SES_JSON=",\"voice\":{\"voiceId\":\"$SES\"}"
ANAHTAR=$(grep -E '^API_ANAHTARI=' "$HEDEF/.env" | cut -d= -f2-)
API=http://127.0.0.1:8080
BASLA=$(date -u +%Y-%m-%dT%H:%M:%S)

YANIT=$(curl -s -m 20 -X POST "$API/call" -H "Authorization: Bearer $ANAHTAR" -H 'Content-Type: application/json' \
  -d "{\"assistantId\":\"$ASISTAN\",\"phoneNumberId\":\"$HAT\",\"customer\":{\"number\":\"$NUMARA\"},\"assistantOverrides\":{\"variableValues\":{\"musteri_adi\":\"\"}$SES_JSON}}")
ID=$(echo "$YANIT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)
[ -n "$ID" ] || { echo "Arama başlatılamadı: $YANIT"; exit 1; }
echo "Arama başlatıldı (id: $ID). Telefonunuz birazdan çalacak..."

ONCEKI=""
for i in $(seq 1 200); do
  sleep 3
  D=$(curl -s -m 10 "$API/call/$ID" -H "Authorization: Bearer $ANAHTAR")
  DURUM=$(echo "$D" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status",""), d.get("endedReason") or "", d.get("durationSeconds") or "")')
  set -- $DURUM
  if [ "${1:-}" != "$ONCEKI" ]; then
    case "${1:-}" in
      queued) echo "  sırada" ;; ringing) echo "  çalıyor" ;; in-progress) echo "  görüşme sürüyor" ;;
      ended) echo "  bitti — neden: ${2:-?} · süre: ${3:-0} sn" ;;
    esac
    ONCEKI=${1:-}
  fi
  [ "${1:-}" = ended ] && break
done

echo
echo "---- Görüşme dökümü ve hatalar ----"
cd "$HEDEF"
docker compose logs --since "${BASLA}Z" ajan 2>&1 | python3 -c '
import json, sys
for satir in sys.stdin:
    i = satir.find("{")
    if i < 0: continue
    try: k = json.loads(satir[i:])
    except Exception: continue
    m = k.get("message", "")
    if m.startswith("RAPOR: "):
        try:
            r = json.loads(m[7:])["message"]
            print(r["artifact"]["transcript"] or "(konuşma yok)")
            print("\nÖzet:", r["analysis"].get("summary") or "-")
            print("Sonuç:", json.dumps(r["analysis"].get("structuredData") or {}, ensure_ascii=False))
        except Exception:
            print(m[:1500])
    elif m.startswith("GECIKME: "):
        g = json.loads(m[9:])
        if g:
            print("\nGecikmeler (ortalama, saniye): cevap süresi ≈", g.get("cevap", "?"),
                  "| söz bitti algısı", g.get("soz_bitti", "?"), "| yazıya çevirme", g.get("yaziya_cevirme", "?"),
                  "| model", g.get("model", "?"), "| seslendirme", g.get("ses", "?"))
    elif k.get("level") in ("ERROR", "WARNING") and not any(x in m for x in ("data channel", "deprecated", "failed to send session event", "unknown FFI handle")):
        print("[" + k["level"] + "]", m.split("\n")[0][:300])
'
echo
echo "Ses kalitesi: sudo bash ~/kalite.sh   ·   Kayıtlar: /var/spool/asterisk/kayit/"

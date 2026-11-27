#!/usr/bin/env bash
# Vapi hesabınızdaki her numaranın hangi NetGSM trunk'ını (sunucu + kullanıcı adı) kullandığını listeler.
# Şifreleri GÖSTERMEZ (Vapi şifreyi geri vermez); şifreler NetGSM'den alınır ve trunk_ekle.sh ile girilir.
#   sudo bash /opt/xre-ai/vapi_trunk_al.sh
# Vapi API anahtarı: Vapi → API Keys → "Private Key"
set -euo pipefail
read -rsp "Vapi Private API Key (ekranda görünmez): " VK; echo
[ -n "$VK" ] || { echo "Anahtar boş."; exit 1; }
G=$(mktemp -d); trap 'rm -rf "$G"' EXIT
curl -s -m 30 https://api.vapi.ai/credential -H "Authorization: Bearer $VK" > "$G/k.json"
curl -s -m 30 "https://api.vapi.ai/phone-number?limit=100" -H "Authorization: Bearer $VK" > "$G/n.json"
python3 - "$G/k.json" "$G/n.json" <<'PY'
import json, sys
try:
    kimlik, numara = (json.load(open(y, encoding="utf-8")) for y in sys.argv[1:3])
except Exception:
    print("✗ Vapi cevabı okunamadı."); sys.exit(1)
for v in (kimlik, numara):
    if isinstance(v, dict):
        print("✗ Vapi: " + str(v.get("message") or v)[:200]); sys.exit(1)
k = {c.get("id"): c for c in kimlik}
print("%-16s %-22s %-26s %s" % ("Numara", "Ad", "SIP sunucusu", "Trunk kullanıcı adı"))
for n in sorted(numara, key=lambda x: str(x.get("name") or "")):
    c = k.get(n.get("credentialId")) or {}
    plan = c.get("outboundAuthenticationPlan") or {}
    gw = ", ".join(str(g.get("ip")) for g in (c.get("gateways") or []) if g.get("ip")) or "-"
    print("%-16s %-22s %-26s %s" % (n.get("number") or "-", str(n.get("name") or "-")[:22], gw[:26], plan.get("authUsername") or c.get("authUsername") or "-"))
# Bir trunk kaydının yapısı: Vapi'nin NetGSM'e nasıl bağlandığını (kayıt/REGISTER, kullanıcı adı biçimi, port) gösterir.
# Şifre, anahtar ve gizli alanların DEĞERİ yazılmaz; yalnızca uzunluğu.
GIZLI = ("pass", "secret", "key", "token", "credential")
def dok(v, ad="", girinti=1):
    bos = "  " * girinti
    if isinstance(v, dict):
        for k, x in v.items():
            if isinstance(x, (dict, list)):
                print(f"{bos}{k}:"); dok(x, k, girinti + 1)
            elif any(g in k.lower() for g in GIZLI):
                print(f"{bos}{k}: (gizli, {len(str(x))} karakter)")
            else:
                print(f"{bos}{k}: {str(x)[:80]}")
    elif isinstance(v, list):
        for x in v[:3]:
            if isinstance(x, (dict, list)):
                print(f"{bos}-"); dok(x, ad, girinti + 1)
            else:
                print(f"{bos}- {str(x)[:80]}")
ornek = next((n for n in numara if n.get("number") == "+905337437116"), numara[0] if numara else None)
if ornek:
    print("\nÖRNEK NUMARA KAYDI (%s):" % ornek.get("number")); dok({k: v for k, v in ornek.items() if k not in ("orgId", "createdAt", "updatedAt", "server", "assistantId", "squadId", "fallbackDestination", "hooks")})
    c = k.get(ornek.get("credentialId"))
    if c:
        print("\nBU NUMARANIN TRUNK KAYDI:"); dok({kk: v for kk, v in c.items() if kk not in ("orgId", "createdAt", "updatedAt")})
    else:
        print("\n(bu numaraya bağlı trunk kaydı bulunamadı; credentialId: %s)" % ornek.get("credentialId"))
print("\nŞifreler burada görünmez. Her numara için NetGSM'den aldığınız şifreyi şu komutla girin:\n  sudo bash /opt/xre-ai/trunk_ekle.sh")
PY

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
print("\nŞifreler burada görünmez. Her numara için NetGSM'den aldığınız şifreyi şu komutla girin:\n  sudo bash /opt/xre-ai/trunk_ekle.sh")
PY

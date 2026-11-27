#!/usr/bin/env bash
# Gelen aramalarda hangi numaranın hangi asistana bağlanacağını Vapi'deki ayardan alır ve bu sunucuya işler.
# Vapi'de hiçbir şeyi değiştirmez. NetGSM gelen aramaları bu sunucuya çevirmeden ÖNCE çalıştırılmalıdır.
#   sudo bash /opt/xre-ai/gelen_esle.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
cd /opt/xre-ai
read -rsp "Vapi Private API Key (ekranda görünmez): " VK; echo
[ -n "$VK" ] || { echo "Anahtar boş."; exit 1; }
G=$(mktemp); trap 'rm -f "$G"' EXIT
curl -s -m 30 "https://api.vapi.ai/phone-number?limit=100" -H "Authorization: Bearer $VK" > "$G" || echo '{"message":"bağlantı kurulamadı"}' > "$G"
python3 - "$G" numaralar.yaml asistanlar <<'PY'
import glob, json, re, sys, yaml
try:
    vapi = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    vapi = {"message": "cevap okunamadı"}
if isinstance(vapi, dict):
    print("✗ Vapi numaraları vermedi:", str(vapi.get("message") or vapi)[:150]); sys.exit(1)
asistanlar = {}
for f in glob.glob(sys.argv[3] + "/*.y*ml"):
    a = yaml.safe_load(open(f, encoding="utf-8")) or {}
    if a.get("vapi_id"): asistanlar[a["vapi_id"]] = a
d = yaml.safe_load(open(sys.argv[2], encoding="utf-8")) or {}
son10 = lambda s: re.sub(r"\D", "", str(s or ""))[-10:]
bizim = {son10(n.get("numara")): n for n in d.get("numaralar") or []}
degisti = eksik = 0
print("%-15s %-34s %s" % ("Numara", "Gelen aramada konuşacak asistan", "Durum"))
for v in sorted(vapi, key=lambda x: str(x.get("number") or "")):
    if not v.get("number"): continue
    n, a = bizim.get(son10(v["number"])), asistanlar.get(v.get("assistantId"))
    if not n:
        print("%-15s %-34s %s" % (v["number"], "-", "✗ bu sunucuda numara tanımlı değil")); eksik += 1
    elif not v.get("assistantId"):
        print("%-15s %-34s %s" % (v["number"], "-", "! Vapi'de bu numaraya gelen arama asistanı bağlı değil")); eksik += 1
    elif not a:
        print("%-15s %-34s %s" % (v["number"], v["assistantId"][:8] + "…", "✗ bu asistan sunucuya aktarılmamış")); eksik += 1
    else:
        if n.get("gelen_asistan") != a["id"]:
            n["gelen_asistan"] = a["id"]; degisti += 1
        print("%-15s %-34s %s" % (v["number"], str(a.get("ad"))[:34], "✓"))
if degisti:
    yaml.safe_dump(d, open(sys.argv[2], "w", encoding="utf-8"), allow_unicode=True, sort_keys=False)
print(f"\n{degisti} numaranın gelen arama asistanı işlendi." + (f" {eksik} numara eşlenemedi; bu numaralara gelen aramalar cevapsız kalır." if eksik else " Bütün numaralar eşlendi."))
PY

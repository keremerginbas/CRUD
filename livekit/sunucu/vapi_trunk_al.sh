#!/usr/bin/env bash
# Trunk şifresini Vapi hesabınızdan okuyup (ekrana yazmadan) bu sunucuya tanıtır.
# Vapi'de trunk'ı eklerken girdiğiniz şifre Vapi'de kayıtlı; kendi hesabınızın API anahtarıyla geri alınabilir.
#   sudo bash /opt/xre-ai/vapi_trunk_al.sh
# Vapi API anahtarı: Vapi → API Keys → "Private Key"
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
read -rsp "Vapi Private API Key (ekranda görünmez): " VK; echo
[ -n "$VK" ] || { echo "Anahtar boş."; exit 1; }
YANIT=$(curl -s -m 30 https://api.vapi.ai/credential -H "Authorization: Bearer $VK")
SONUC=$(printf '%s' "$YANIT" | python3 -c '
import json, sys
try:
    veri = json.load(sys.stdin)
except Exception:
    print("HATA|Vapi cevabı okunamadı"); sys.exit()
if isinstance(veri, dict):
    print("HATA|" + str(veri.get("message") or veri)[:200]); sys.exit()
trunklar = [c for c in veri if "sip" in str(c.get("provider", "")).lower()]
if not trunklar:
    print("HATA|Hesapta SIP trunk kaydı bulunamadı. Kayıt türleri: " + ", ".join(sorted({str(c.get("provider")) for c in veri}))); sys.exit()
for c in trunklar:
    plan = c.get("outboundAuthenticationPlan") or {}
    kul = plan.get("authUsername") or c.get("authUsername") or ""
    sifre = plan.get("authPassword") or c.get("authPassword") or ""
    gw = [g.get("ip") for g in (c.get("gateways") or []) if g.get("ip")]
    if kul and sifre and "*" not in sifre:
        print("TAMAM|%s|%s|%s" % (gw[0] if gw else "sip8.netsantral.com", kul, sifre)); sys.exit()
c = trunklar[0]
plan = c.get("outboundAuthenticationPlan") or {}
print("YOK|Vapi şifreyi geri vermiyor. Kayıttaki alanlar: " + ", ".join(sorted(c.keys())) + " | kimlik planı alanları: " + ", ".join(sorted(plan.keys())))
')
IFS='|' read -r DURUM A B C <<< "$SONUC"
case "$DURUM" in
  TAMAM) echo "Vapi'de trunk bulundu: sunucu $A · kullanıcı $B · şifre alındı (gösterilmiyor)."
         TRUNK_HOST="$A" TRUNK_KUL="$B" TRUNK_SIFRE="$C" bash /opt/xre-ai/trunk_ekle.sh ;;
  YOK)   echo "✗ $A"; echo "  Bu durumda şifre yalnızca NetGSM'den alınabilir." ;;
  *)     echo "✗ ${A:-Bilinmeyen hata}" ;;
esac

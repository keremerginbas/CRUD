#!/usr/bin/env bash
# Vapi hesabınızdaki bütün asistanları (metin, ilk cümle, ses, araçlar, n8n adresi, analiz) bu sunucuya aktarır.
# Vapi'de hiçbir şeyi değiştirmez. Daha önce aktarılmış asistanlara dokunmaz (panelde yaptığınız değişiklikler korunur).
#   sudo bash /opt/xre-ai/vapi_asistan_al.sh             → yeni asistanları aktarır
#   sudo bash /opt/xre-ai/vapi_asistan_al.sh --uzerine   → hepsini Vapi'deki son hâliyle yeniler
# Vapi API anahtarı: Vapi → API Keys → "Private Key"
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
HEDEF=/opt/xre-ai
read -rsp "Vapi Private API Key (ekranda görünmez): " VK; echo
[ -n "$VK" ] || { echo "Anahtar boş."; exit 1; }
G=$(mktemp -d); trap 'rm -rf "$G"' EXIT
al() { curl -s -m 60 "https://api.vapi.ai/$1" -H "Authorization: Bearer $VK" > "$2" || echo '{"message":"bağlantı kurulamadı"}' > "$2"; }
echo "Vapi'den okunuyor..."
al "assistant?limit=1000" "$G/a.json"; al "tool?limit=1000" "$G/t.json"; al "structured-output?limit=100" "$G/c.json"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$G/c.json" 2>/dev/null || echo '[]' > "$G/c.json"
python3 "$HEDEF/vapi_asistan_cevir.py" "$G/a.json" "$G/t.json" "$G/c.json" "$HEDEF/asistanlar" "$@"
echo "Panelde Asistanlar sayfasını yenileyin. Bir asistanı açıp “Beni ara” ile deneyebilirsiniz."

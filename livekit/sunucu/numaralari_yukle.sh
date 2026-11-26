#!/usr/bin/env bash
# XRE'nin 16 yapay zekâ numarasını ön ekleriyle birlikte sunucuya yükler (eski liste yedeklenir).
#   sudo bash /opt/xre-ai/numaralari_yukle.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root olarak çalıştırın (sudo)."; exit 1; }
cd /opt/xre-ai
cp numaralar.yaml "numaralar.yaml.yedek-$(date +%Y%m%d-%H%M%S)"
cat numaralar_xre.yaml > numaralar.yaml      # yerinde yaz: dosya Docker'a bağlı
python3 - <<'PY'
import yaml
n = yaml.safe_load(open("/opt/xre-ai/numaralar.yaml"))["numaralar"]
print(f"{len(n)} numara yüklendi:")
for x in n:
    print(f"  {x['numara']}  ön ek {x['on_ek'] or '-':>2}  {x['ad']}")
PY
echo "Panelde Numaralar sayfasından görebilir ve değiştirebilirsiniz."

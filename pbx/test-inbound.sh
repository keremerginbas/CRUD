#!/usr/bin/env bash
# Trunk olmadan gelen arama akışını dener. Santral konteynerinde (CT 150):
#   /opt/santral/pbx/test-inbound.sh [arayan] [aranan]
# Varsayılan: 05464962638, 905337435601'i arıyor. Dışarıya arama çıkmaz (trunk yoksa Dial başarısız olur).
set -euo pipefail
FROM="${1:-05464962638}"; TO="${2:-905337435601}"
: > /tmp/xre-test.log
asterisk -rx "channel originate Local/${FROM}-${TO}@xre-test-in extension s@xre-test" >/dev/null
sleep 6
echo "== Uygulamanın kararı:"
grep -h "Uygulamanın kararı" /var/log/asterisk/messages.log | tail -1 | sed 's/.*NoOp(//; s/).*//'
echo "== Kapanış:"
grep -h "Kapanış" /var/log/asterisk/messages.log | tail -1 | sed 's/.*NoOp(//; s/).*//'

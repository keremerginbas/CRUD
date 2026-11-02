#!/usr/bin/env bash
# Uygulama (CT 140) ile santrali (CT 150) birbirine bağlar. Proxmox kabuğunda root olarak:
#   pct exec 150 -- cat /opt/santral/pbx/connect.sh | bash
# Şifreler otomatik üretilir/taşınır; ekrana yazılmaz.
set -euo pipefail
CT_APP="${CT_APP:-140}"; CT_PBX="${CT_PBX:-150}"
APP_IP="${APP_IP:-192.168.1.253}"; PBX_IP="${PBX_IP:-192.168.1.247}"
ENV=/opt/santral/server/.env

get_env() { pct exec "$CT_APP" -- grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
set_env() {
  pct exec "$CT_APP" -- bash -c "grep -q '^$1=' $ENV && sed -i 's#^$1=.*#$1=$2#' $ENV || echo '$1=$2' >> $ENV"
}

TOKEN="$(get_env PBX_WEBHOOK_SECRET)"
[[ -n "$TOKEN" ]] || { echo "CT $CT_APP içinde PBX_WEBHOOK_SECRET bulunamadı"; exit 1; }
ASSIST="$(get_env ASSISTANT_DESTINATION | sed 's/^+90/0/')"
ARIPASS="$(openssl rand -hex 24)"
# İkinci dahili (pbx/trunk.sh agent) bağlıysa danışman aramaları ondan yapılır
AGENT=trunk
pct exec "$CT_PBX" -- test -s /etc/asterisk/pjsip_agent.conf && AGENT=agent

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/xre_globals.conf" <<CONFEOF
; pbx/connect.sh tarafından yazıldı
APP_URL=http://$APP_IP:3000
APP_TOKEN=$TOKEN
TRUNK=trunk
AGENT_TRUNK=$AGENT
SOUNDS=/var/lib/asterisk/sounds/custom
HUNT_FALLBACK=$ASSIST
CONFEOF
cat > "$TMP/ari_users.conf" <<CONFEOF
; pbx/connect.sh tarafından yazıldı
[xre]
type=user
read_only=no
password=$ARIPASS
password_format=plain
CONFEOF
for f in xre_globals.conf ari_users.conf; do
  pct push "$CT_PBX" "$TMP/$f" "/etc/asterisk/$f" --perms 640
  pct exec "$CT_PBX" -- chown asterisk:asterisk "/etc/asterisk/$f"
done
pct exec "$CT_PBX" -- asterisk -rx 'core reload' >/dev/null

set_env PBX_PROVIDER asterisk
set_env ASTERISK_ARI_URL "http://$PBX_IP:8088"
set_env ASTERISK_ARI_USER xre
set_env ASTERISK_ARI_PASSWORD "$ARIPASS"
set_env ASTERISK_TRUNK trunk
set_env ASTERISK_AGENT_TRUNK "$AGENT"
pct exec "$CT_APP" -- systemctl restart santral
sleep 3

echo "== Uygulama → santral (ARI):"
pct exec "$CT_APP" -- curl -s -m 5 -u "xre:$ARIPASS" "http://$PBX_IP:8088/ari/asterisk/info" | grep -o '"version":"[^"]*"' || echo "ULASILAMADI"
echo "== Santral → uygulama:"
pct exec "$CT_PBX" -- curl -s -m 5 "http://$APP_IP:3000/health" || echo "ULASILAMADI"
echo
echo "== Asistan (yedek) hattı: ${ASSIST:-TANIMLI DEĞİL}"
echo "== Danışmanları arayan bağlantı: $AGENT"

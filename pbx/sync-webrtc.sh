#!/usr/bin/env bash
# Paneldeki kullanıcıları santralin tarayıcı telefonu kullanıcılarına aktarır. Proxmox kabuğunda root olarak:
#   pct exec 150 -- cat /opt/santral/pbx/sync-webrtc.sh | bash
# Değişiklik yoksa santrale dokunmaz; cron ile birkaç dakikada bir çalıştırılabilir.
set -euo pipefail
CT_APP="${CT_APP:-140}"; CT_PBX="${CT_PBX:-150}"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
pct exec "$CT_APP" -- bash -c 'cd /opt/santral/server && runuser -u santral -- node --env-file=.env src/sip-users.js 2>/dev/null' > "$TMP"
grep -q "xre-webrtc-endpoint" "$TMP" || { echo "Kullanıcı listesi alınamadı"; exit 1; }
NEW="$(sha256sum < "$TMP" | cut -c1-64)"
OLD="$(pct exec "$CT_PBX" -- sha256sum /etc/asterisk/pjsip_webrtc_users.conf 2>/dev/null | cut -c1-64 || true)"
if [[ "$NEW" == "$OLD" ]]; then echo "== Değişiklik yok"; exit 0; fi
pct push "$CT_PBX" "$TMP" /etc/asterisk/pjsip_webrtc_users.conf --perms 640
pct exec "$CT_PBX" -- chown asterisk:asterisk /etc/asterisk/pjsip_webrtc_users.conf
pct exec "$CT_PBX" -- asterisk -rx 'module reload res_pjsip.so' >/dev/null
echo "== Tarayıcı telefonu kullanıcıları güncellendi: $(grep -c 'xre-webrtc-endpoint' "$TMP")"

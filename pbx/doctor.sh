#!/usr/bin/env bash
# Santralin sağlık kontrolü: operatör bağlantıları, uygulama bağlantısı, güvenlik. Hiçbir şeyi değiştirmez.
# Santral konteynerinde (CT 150) root olarak:  /opt/santral/pbx/doctor.sh
# Çıkış kodu: 0 = sorun yok, 1 = en az bir ✗ var
set -uo pipefail
CONF="${XRE_CONF:-/etc/asterisk}"
LOGF="${XRE_LOG:-/var/log/asterisk/messages.log}"
ast() { asterisk ${ASTERISK_OPTS:-} -rx "$1" 2>/dev/null; }
BAD=0
ok() { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; BAD=1; }
warn() { echo "  ! $*"; }
gvar() { ast "dialplan show globals" | sed -n "s/^ *$1=//p" | head -1; }

echo "== Santral"
if ast 'core show version' | grep -q Asterisk; then ok "Asterisk çalışıyor ($(ast 'core show version' | awk '{print $2}'))"
else bad "Asterisk çalışmıyor: systemctl status asterisk"; exit 1; fi

echo "== Operatör bağlantıları"
NAMES="$(ls "$CONF"/xre.d/pjsip-*.conf 2>/dev/null | sed -n 's#.*/pjsip-\([a-z][a-z0-9_]*\)\.conf$#\1#p')"
for legacy in trunk agent; do
  [[ -s "$CONF/pjsip_$legacy.conf" ]] && grep -q "type=endpoint" "$CONF/pjsip_$legacy.conf" && NAMES="$NAMES $legacy" \
    && warn "$legacy eski biçimde kayıtlı; pbx/trunk.sh $legacy ile yeniden yazın (biçim/kanal ayarı için)"
done
[[ -n "${NAMES// /}" ]] || bad "Hiç operatör bağlantısı yok: pbx/trunk.sh"
for n in $NAMES; do
  EP="$(ast "pjsip show endpoint $n")"
  if ! grep -q "Endpoint:  *$n " <<<"$EP"; then bad "$n: santralde yüklenmemiş (dosya hatalı?)"; continue; fi
  CTX="$(ast "pjsip show endpoint $n" | sed -n 's/^ *context *: *//p' | head -1)"
  STATE="$(grep -E "^ *Contact: +$n/" <<<"$EP" | awk '{print $4}' | head -1)"
  REG="$(ast 'pjsip show registrations' | awk -v r="$n-reg/" 'index($1, r) == 1 {
    for (i = 2; i <= NF; i++) if ($i ~ /^(Registered|Unregistered|Rejected|Retrying|Stopped)$/) print $i }' | head -1)"
  INFO="$(gvar "CH_$n") kanal, biçim $(gvar "CLI_$n"), numara $(gvar "DID_$n")"
  [[ "$n" == "agent" && "$CTX" != "from-agent" ]] && bad "$n: gelen arama açabiliyor (context=$CTX); pbx/trunk.sh agent ile yeniden yazın"
  if [[ -n "$REG" && "$REG" != "Registered" ]]; then bad "$n: operatöre kayıt olamadı ($REG) — kullanıcı adı/şifre ya da sunucu yanlış"
  elif [[ "$STATE" == "Avail" || "$STATE" == "NonQual" ]]; then ok "$n: ${REG:+kayıtlı, }erişilebilir ($INFO)"
  else bad "$n: operatöre ulaşılamıyor (durum: ${STATE:-yok}) — internet/modem/IP izni"; fi
done

echo "== Varsayılanlar"
T="$(gvar TRUNK)"; AG="$(gvar AGENT_TRUNK)"
if [[ -n "$T" ]] && ast "pjsip show endpoint $T" | grep -q "Endpoint:  *$T "; then ok "varsayılan bağlantı: $T"
else bad "varsayılan bağlantı ($T) santralde yok: connect.sh"; fi
if [[ -z "$AG" ]] || ast "pjsip show endpoint $AG" | grep -q "Endpoint:  *$AG "; then ok "danışman cebini arayan bağlantı: ${AG:-$T}"
else bad "danışman bağlantısı ($AG) santralde yok: connect.sh"; fi
HF="$(gvar HUNT_FALLBACK)"; [[ -n "$HF" ]] && ok "asistan hattı: $HF" || warn "asistan hattı tanımlı değil (ASSISTANT_DESTINATION)"

echo "== Uygulama"
URL="$(gvar APP_URL)"
if curl -sf -m 5 "$URL/health" >/dev/null; then ok "uygulamaya ulaşılıyor ($URL)"; else bad "uygulamaya ulaşılamıyor ($URL): CT 140 açık mı?"; fi
WU="$(grep -c '(xre-webrtc-endpoint)' "$CONF/pjsip_webrtc_users.conf" 2>/dev/null)"; WU="${WU:-0}"
[[ "$WU" -gt 0 ]] && ok "tarayıcı telefonu kullanıcıları: $WU" || warn "tarayıcı telefonu kullanıcısı yok: pbx/sync-webrtc.sh"

echo "== Güvenlik"
if grep -q "^deny=0.0.0.0/0.0.0.0" "$CONF/pjsip.conf"; then ok "SIP sadece iç ağdan ve operatörlerden kabul ediliyor"; else bad "pjsip.conf [acl] eksik"; fi
# Operatör bize ait olmayan aramaları gönderiyorsa (ör. Netgsm departmanına eklenmiş dahili) burada görünür
if [[ -r "$LOGF" ]]; then
  REJ="$(grep -c "açılmadan reddedildi" "$LOGF" 2>/dev/null)"
  if [[ "${REJ:-0}" -gt 0 ]]; then
    warn "$REJ arama 'bize ait değil' diye reddedildi. Operatör panelinde bu bağlantının dahilisi bir"
    warn "departmanda/kuyrukta/IVR'da mı? Öyleyse çıkarın; şirketin diğer aramaları buraya gelmesin."
    grep "Gelen arama:" "$LOGF" | tail -3 | sed 's/.*Gelen arama: /      son: /; s/").*//'
  else ok "reddedilen yabancı arama yok"; fi
fi
SND="$(gvar SOUNDS)"
N=$(ls "$SND"/xre-*.wav 2>/dev/null | wc -l)
[[ "$N" -ge 5 ]] && ok "anonslar hazır ($N)" || warn "anons dosyaları eksik ($N/5): pbx/sounds.sh"

echo
[[ "$BAD" == "0" ]] && echo "== Sorun yok" || echo "== ✗ işaretli maddeleri düzeltin"
exit "$BAD"

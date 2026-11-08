#!/usr/bin/env bash
# Arayan numara testi: bir hattan, seçilen operatör bağlantısıyla KENDİ telefonunuzu arar.
# Telefonunuzun ekranında hangi numara görünüyorsa müşteri de onu görür. Santral konteynerinde (CT 150) root olarak:
#   /opt/santral/pbx/cli-test.sh <hat> <kendi telefonunuz> [bağlantı]
#   /opt/santral/pbx/cli-test.sh 03122191672 05321112233 tt
# Bağlantı verilmezse varsayılan bağlantı kullanılır. Sadece kendi telefonunuzu arayın.
set -euo pipefail
ast() { asterisk ${ASTERISK_OPTS:-} -rx "$1"; }
LINE="${1:-}"; PHONE="${2:-}"; TRK="${3:-}"
LINE="${LINE//[^0-9]/}"; PHONE="${PHONE//[^0-9]/}"
[[ "$LINE" =~ ^0?[0-9]{10}$|^444[0-9]{4}$ ]] || { echo "Kullanım: $0 <hat ör. 03122191672> <telefonunuz ör. 05321112233> [bağlantı]"; exit 1; }
[[ "${PHONE:0:1}" == "0" ]] || PHONE="0$PHONE"
[[ "$PHONE" =~ ^0[2-5][0-9]{9}$ ]] || { echo "Telefon 0 ile başlayan 11 haneli Türkiye numarası olmalı"; exit 1; }
[[ -z "$TRK" || "$TRK" =~ ^[a-z][a-z0-9_]{1,19}$ ]] || { echo "Geçersiz bağlantı adı"; exit 1; }
SOUNDS="$(ast 'dialplan show globals' | sed -n 's/^ *SOUNDS=//p' | head -1)"
APP="Wait 10"; [[ -f "$SOUNDS/xre-danismaniniz-ariyor.wav" ]] && APP="Playback custom/xre-danismaniniz-ariyor"
echo "== $PHONE aranıyor: hat $LINE, bağlantı ${TRK:-varsayılan}. Açınca anons duyacaksınız; ekrandaki numaraya bakın."
ast "channel originate Local/$LINE-${TRK:-x}-$PHONE@xre-cli-test application $APP" >/dev/null
sleep "${XRE_WAIT:-3}"
ast 'core show channels concise' | grep -q "xre-cli-test" && echo "== Arama sürüyor" || {
  echo "== Arama kurulamadı. Son satırlar:"; grep -E "xre-cli-test|Arama sonucu" "${XRE_LOG:-/var/log/asterisk/messages.log}" 2>/dev/null | tail -5; }
cat <<MSG
== Ekranda $LINE (ya da biçimi) görünüyorsa: operatör bu numarayı göstermeye izin veriyor.
   Bağlantının ana numarası ya da "gizli" görünüyorsa: operatörden bu numaranın bu bağlantıdan
   gösterilmesine izin isteyin (numara adınıza kayıtlı olmalı) ya da numarayı o operatöre taşıyın.
MSG

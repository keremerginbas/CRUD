#!/usr/bin/env bash
# Asterisk'i kaynaktan derleyip XRE ayarlarıyla kurar. Santral konteynerinde (CT 150) root olarak çalıştırın:
#   /opt/santral/pbx/install.sh
# Tekrar çalıştırılabilir: Asterisk kuruluysa derlemeyi atlar, sadece ayarları günceller (yeniden derlemek için FORCE=1).
set -euo pipefail
VERSION="${ASTERISK_VERSION:-22-current}"
REPO="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

if [[ ! -x /usr/sbin/asterisk || "${FORCE:-0}" == "1" ]]; then
  echo "== Paketler"
  apt-get update -q
  apt-get install -y -q build-essential wget curl ca-certificates openssl libcurl4-openssl-dev libssl-dev \
    libxml2-dev libsqlite3-dev uuid-dev libedit-dev libjansson-dev pkg-config >/dev/null

  echo "== Asterisk $VERSION indiriliyor"
  mkdir -p /usr/src/asterisk-build && cd /usr/src/asterisk-build
  rm -rf asterisk-*/
  wget -q "https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-${VERSION}.tar.gz" -O asterisk.tar.gz
  tar xzf asterisk.tar.gz && cd asterisk-*/
  echo "== Kaynak klasörü: $(pwd)"

  echo "== Bağımlılıklar"
  contrib/scripts/install_prereq install >/dev/null

  echo "== Yapılandırma"
  ./configure --with-pjproject-bundled --with-jansson-bundled >/dev/null
  make menuselect.makeopts >/dev/null
  menuselect/menuselect --enable func_curl --enable app_mixmonitor --enable res_ari_channels --enable res_ari_recordings menuselect.makeopts

  echo "== Derleniyor (10-20 dakika sürebilir)"
  make -j"$(nproc)" >/dev/null
  make install >/dev/null
  make samples >/dev/null
  ldconfig
fi

echo "== Kullanıcı ve klasörler"
id asterisk >/dev/null 2>&1 || useradd --system --home /var/lib/asterisk --shell /usr/sbin/nologin asterisk
# Örnek ayarlardaki demo dialplan'ları kaldır; sadece bizim ayarlarımız çalışsın
rm -f /etc/asterisk/extensions.ael /etc/asterisk/extensions.lua /etc/asterisk/users.conf
install -m 640 "$REPO"/asterisk/*.conf /etc/asterisk/
for f in pjsip_trunk.conf pjsip_trunk_acl.conf pjsip_agent.conf pjsip_agent_acl.conf pjsip_webrtc_users.conf xre_globals.conf xre_trunk.conf ari_users.conf; do
  [[ -f /etc/asterisk/$f ]] || install -m 640 /dev/null /etc/asterisk/$f
done
# Operatör bağlantıları klasörü (pbx/trunk.sh <ad>); boş dosyalar, hiç bağlantı yokken de ayarlar yüklensin diye
mkdir -p /etc/asterisk/xre.d
for f in pjsip acl globals; do
  [[ -f /etc/asterisk/xre.d/$f-00-bos.conf ]] || echo "; boş: bağlantılar pbx/trunk.sh ile eklenir" > /etc/asterisk/xre.d/$f-00-bos.conf
done
mkdir -p /var/lib/asterisk/sounds/custom /var/spool/asterisk/recording /var/log/asterisk
# Eski adlarla yazılmış trunk dosyaları artık kullanılmıyor
rm -f /etc/asterisk/pjsip_netgsm.conf /etc/asterisk/pjsip_netgsm_acl.conf
chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk /var/log/asterisk /var/spool/asterisk

echo "== Servis"
install -m 644 "$REPO"/asterisk/asterisk.service /etc/systemd/system/asterisk.service
systemctl daemon-reload
systemctl enable -q asterisk
systemctl restart asterisk
sleep 4
echo "== Durum: $(systemctl is-active asterisk)"
asterisk -rx 'core show version' || true
asterisk -rx 'module show like func_curl' | tail -1 || true

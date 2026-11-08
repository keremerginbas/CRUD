#!/usr/bin/env bash
# Santral ayarlarını uçtan uca dener: gerçek Asterisk (bizim ayarlarımız) + operatör yerine ikinci bir Asterisk
# + gerçek uygulama sunucusu. Ses değil, sinyal test edilir: kim, hangi bağlantıdan, hangi numarayla aranıyor.
# Geliştirme makinesinde (santral sunucusunda DEĞİL) root olarak:
#   apt-get install -y asterisk && pbx/test/e2e.sh
# Kullanılan portlar: 5060, 5070 (127.0.0.2-5), 8088, 3999. KEEP=1: çalışma klasörü silinmez.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
W="$(mktemp -d /tmp/xre-e2e.XXXXXX)"; chmod 755 "$W"
MODDIR="$(dirname "$(find /usr/lib -path '*asterisk/modules/res_pjsip.so' | head -1)")"
[[ -d "$MODDIR" ]] || { echo "Asterisk modülleri bulunamadı (apt-get install asterisk)"; exit 1; }
APP_PID=""
A() { asterisk -C "$W/pbx/etc/asterisk.conf" -rx "$1"; }
B() { asterisk -C "$W/op/etc/asterisk.conf" -rx "$1"; }
cleanup() {
  A 'core stop now' >/dev/null 2>&1 || true
  B 'core stop now' >/dev/null 2>&1 || true
  [[ -n "$APP_PID" ]] && kill "$APP_PID" 2>/dev/null || true
  [[ "${KEEP:-0}" == "1" ]] && echo "Çalışma klasörü: $W" || rm -rf "$W"
}
trap cleanup EXIT

mkinst() {
  mkdir -p "$W/$1"/{etc,run,spool,lib,log}
  cat > "$W/$1/etc/asterisk.conf" <<EOF
[directories]
astetcdir => $W/$1/etc
astmoddir => $MODDIR
astvarlibdir => $W/$1/lib
astdbdir => $W/$1/lib
astkeydir => $W/$1/lib
astdatadir => /usr/share/asterisk
astagidir => /usr/share/asterisk/agi-bin
astspooldir => $W/$1/spool
astrundir => $W/$1/run
astlogdir => $W/$1/log
astsbindir => /usr/sbin
[options]
runuser => asterisk
rungroup => asterisk
EOF
  printf '[general]\ndateformat=%%F %%T\n[logfiles]\nmessages.log => notice,warning,error,verbose(3)\n' > "$W/$1/etc/logger.conf"
}
start() {
  # Gerçek kurulumdaki gibi asterisk kullanıcısıyla çalışır
  chown -R asterisk:asterisk "$W/$1"
  asterisk -C "$W/$1/etc/asterisk.conf" -f -n > "$W/$1/log/console.log" 2>&1 &
  for _ in $(seq 50); do
    asterisk -C "$W/$1/etc/asterisk.conf" -rx 'core waitfullybooted' >/dev/null 2>&1 && return 0; sleep 0.2
  done
  echo "Asterisk ($1) açılmadı:"; tail -30 "$W/$1/log/console.log"; exit 1
}

# ---------- Santral (bizim ayarlarımız) ----------
mkinst pbx
E="$W/pbx/etc"
cp "$REPO"/pbx/asterisk/*.conf "$E/"
for f in pjsip_trunk.conf pjsip_trunk_acl.conf pjsip_agent.conf pjsip_agent_acl.conf; do : > "$E/$f"; done
# Eski kurulumdan kalan değer (CLI_ tanımsız bağlantılar için PAI sunucusu)
printf 'TRUNK_DID=\nTRUNK_HOST=eski.sunucu\n' > "$E/xre_trunk.conf"
mkdir -p "$E/xre.d"
for f in pjsip acl globals; do echo "; boş" > "$E/xre.d/$f-00-bos.conf"; done
# Testte operatörler 127.0.0.x'te: bu adresler iç ağ sayılsın (dış IP'ye çevrilmesin)
sed -i 's#^local_net=192.168.1.0/24#&\nlocal_net=127.0.0.0/8#' "$E/pjsip.conf"
sed -i 's/^bindaddr=.*/bindaddr=127.0.0.1/' "$E/http.conf"
mkdir -p /var/spool/asterisk/recording && chown asterisk:asterisk /var/spool/asterisk/recording
cat > "$E/xre_globals.conf" <<EOF
APP_URL=http://127.0.0.1:3999
APP_TOKEN=e2e
TRUNK=netgsm
AGENT_TRUNK=netgsm
SOUNDS=$W/sounds
HUNT_FALLBACK=05312814423
EOF
printf '[xre]\ntype=user\nread_only=no\npassword=e2e\npassword_format=plain\n' > "$E/ari_users.conf"
# Tarayıcı telefonu yerine düz SIP kullanıcıları (aynı dialplan: xre-webrtc)
for u in 1 2 3; do
  printf '[u%s]\ntype=endpoint\ntransport=transport-udp\ncontext=xre-webrtc\ndisallow=all\nallow=ulaw,alaw\nauth=u%s\naors=u%s\ndirect_media=no\n[u%s]\ntype=auth\nauth_type=userpass\nusername=u%s\npassword=u%spass\n[u%s]\ntype=aor\nmax_contacts=1\n\n' \
    "$u" "$u" "$u" "$u" "$u" "$u" "$u"
done > "$E/pjsip_webrtc_users.conf"
echo "permit=127.0.0.4/255.255.255.255" > "$E/xre.d/acl-e2e.conf"
start pbx

# Operatör bağlantıları gerçek kurulumdaki gibi pbx/trunk.sh ile yazılır
export XRE_CONF="$E" ASTERISK_OPTS="-C $E/asterisk.conf" XRE_WAIT=1
#               operatör  sunucu          yöntem ek-IP  numara      kanal biçim  kullanıcı   şifre
printf '%s\n' 1 127.0.0.2:5070 2 "" 8503465993 1 10 | "$REPO/pbx/trunk.sh" netgsm >/dev/null
printf '%s\n' 3 127.0.0.3:5070 2 "" 3122191672 4 0 | "$REPO/pbx/trunk.sh" tt >/dev/null
printf '%s\n' 2 127.0.0.5:5070 1 "" 8501112233 2 90 vm1 verisifre | "$REPO/pbx/trunk.sh" verimor >/dev/null
# Aynı operatör sunucusunda ikinci hesap (Netgsm'de 119 ve 114 gibi)
printf '%s\n' 2 127.0.0.5:5070 1 "" 8501112244 1 90 vm2 verisifre2 | "$REPO/pbx/trunk.sh" verimor2 >/dev/null
if printf '%s\n' 1 '127.0.0.2;x' | "$REPO/pbx/trunk.sh" kotu >/dev/null 2>&1; then echo "HATA: geçersiz sunucu kabul edildi"; exit 1; fi
if printf '%s\n' 3 127.0.0.3:5070 2 "" 3122190000 1 0 | "$REPO/pbx/trunk.sh" tt2 >/dev/null 2>&1; then echo "HATA: aynı sunucuda ikinci IP bağlantısı kabul edildi"; exit 1; fi
[[ ! -f "$E/xre.d/pjsip-tt2.conf" ]] || { echo "HATA: reddedilen bağlantının dosyası kaldı"; exit 1; }
# Eski biçimde (globals'ı olmayan) bir bağlantı: sadece giden arama için, TT sunucusunda
sed -e 's/\btt\b/eski/g; s/\btt-/eski-/g' "$E/xre.d/pjsip-tt.conf" | sed '/^\[eski-identify\]/,$d' > "$E/xre.d/pjsip-eski.conf"
A 'module reload res_pjsip.so' >/dev/null

# ---------- Operatör (sahte) ----------
mkinst op
O="$W/op/etc"
printf '[modules]\nautoload=yes\n' > "$O/modules.conf"
printf '[general]\nrtpstart=20000\nrtpend=20200\n' > "$O/rtp.conf"
cat > "$O/pjsip.conf" <<'EOF'
[global]
type=global
endpoint_identifier_order=username,ip
[t-netgsm]
type=transport
protocol=udp
bind=127.0.0.2:5070
[t-tt]
type=transport
protocol=udp
bind=127.0.0.3:5070
[t-user]
type=transport
protocol=udp
bind=127.0.0.4:5070
[t-verimor]
type=transport
protocol=udp
bind=127.0.0.5:5070
; santralden gelen her şey
[pbx]
type=endpoint
context=op-in
disallow=all
allow=alaw,ulaw
aors=pbx
direct_media=no
[pbx]
type=aor
contact=sip:127.0.0.1:5060
[pbx-id]
type=identify
endpoint=pbx
match=127.0.0.1
; Verimor gibi şifreyle kayıt olan hesap
[vm1]
type=endpoint
context=op-in
disallow=all
allow=alaw,ulaw
auth=vm1
aors=vm1
direct_media=no
[vm1]
type=auth
auth_type=userpass
username=vm1
password=verisifre
[vm1]
type=aor
max_contacts=1
remove_existing=yes
[vm2]
type=endpoint
context=op-in
disallow=all
allow=alaw,ulaw
auth=vm2
aors=vm2
direct_media=no
[vm2]
type=auth
auth_type=userpass
username=vm2
password=verisifre2
[vm2]
type=aor
max_contacts=1
remove_existing=yes
; operatörden santrale gelen arama
[topbx]
type=aor
contact=sip:127.0.0.1:5060
[topbx_netgsm]
type=endpoint
transport=t-netgsm
aors=topbx
disallow=all
allow=alaw,ulaw
[topbx_tt]
type=endpoint
transport=t-tt
aors=topbx
disallow=all
allow=alaw,ulaw
EOF
for u in 1 2 3; do
  printf '[asu%s]\ntype=endpoint\ntransport=t-user\naors=topbx\noutbound_auth=asu%s\nfrom_user=u%s\ndisallow=all\nallow=alaw,ulaw\n[asu%s]\ntype=auth\nauth_type=userpass\nusername=u%s\npassword=u%spass\n' \
    "$u" "$u" "$u" "$u" "$u" "$u" >> "$O/pjsip.conf"
done
cat > "$O/extensions.conf" <<'EOF'
[op-in]
exten => _[0-9a-z+].,1,Log(NOTICE,E2E-IN to=${EXTEN} from=${CALLERID(num)} pai=${PJSIP_HEADER(read,P-Asserted-Identity)} via=${CHANNEL(pjsip,local_addr)})
 same => n,Answer()
 same => n,Wait(2)
 same => n,Hangup()
; gönderen: <aranan>-<bağlantı>-<arayan>
[e2e-out]
exten => _[+0-9].,1,Set(CALLERID(num)=${CUT(EXTEN,-,3)})
 same => n,Dial(PJSIP/${CUT(EXTEN,-,1)}@${CUT(EXTEN,-,2)},10,g)
 same => n,Log(NOTICE,E2E-RESULT ${EXTEN} ${DIALSTATUS})
EOF
start op

# ---------- Uygulama ----------
export DB_PATH="$W/app.db"
(cd "$REPO/server" && node -e "
const { openDb } = await import('./src/db.js');
const { hashPassword } = await import('./src/auth.js');
const db = openDb(process.env.DB_PATH);
const add = db.prepare(\`INSERT INTO users (name, email, password_hash, phone, forward_phone, sip_secret, work_start, work_end,
  saturday_start, saturday_end, sunday_enabled, sunday_start, sunday_end) VALUES (?, ?, ?, ?, ?, ?, '00:00','23:59','00:00','23:59',1,'00:00','23:59')\`);
add.run('KAAN', 'kaan', hashPassword('x'), '+905321112233', '+905321112233', 'u1pass');
add.run('MERVE', 'merve', hashPassword('x'), '+905339998877', '+905339998877', 'u2pass');
add.run('AHMET', 'ahmet', hashPassword('x'), '+905350001122', '+905350001122', 'u3pass');
db.exec(\`INSERT INTO numbers (did, type, user_id, label, trunk) VALUES
  ('+903122191672', 'personal', 1, 'Kaan 0312', NULL),
  ('+905337435628', 'personal', 2, 'Merve 5628', 'netgsm'),
  ('+908501112233', 'personal', 3, 'Ahmet 850', 'verimor'),
  ('+908501112244', 'listing', 3, 'Ahmet ilan 850', NULL),
  ('4442453', 'hunt', NULL, '444', NULL)\`);
db.exec(\"INSERT INTO contacts (name, phone, owner_id) VALUES ('MUSTAFA', '+905464962638', 1)\");
" --input-type=module)
(cd "$REPO/server" && PORT=3999 PBX_PROVIDER=asterisk ASTERISK_ARI_URL=http://127.0.0.1:8088 ASTERISK_ARI_USER=xre \
  ASTERISK_ARI_PASSWORD=e2e ASTERISK_TRUNK=netgsm PBX_WEBHOOK_SECRET=e2e ASSISTANT_DESTINATION=+905312814423 JWT_SECRET=e2e \
  exec node src/index.js > "$W/app.log" 2>&1) &
APP_PID=$!
for _ in $(seq 50); do curl -sf http://127.0.0.1:3999/health >/dev/null && break; sleep 0.2; done

# PAUSE=1: senaryolardan önce bekler (elle denemek için; A/B komutları üstte)
[[ "${PAUSE:-0}" == "1" ]] && { echo "HAZIR $W"; sleep 900; }
# ---------- Senaryolar ----------
FAIL=0
LOG="$W/op/log/messages.log"
call() { B "channel originate Local/$1@e2e-out application Wait 6" >/dev/null; sleep "${2:-4}"; }
expect() { # açıklama, beklenen satır parçası (E2E-IN ya da E2E-RESULT); arama bitene kadar bekler
  for _ in $(seq 20); do grep -qF -- "$2" "$LOG" && break; sleep 0.5; done
  if grep -qF -- "$2" "$LOG"; then echo "  ✓ $1"; else echo "  ✗ $1"; echo "      beklenen: $2"; FAIL=1; fi
}
expect_pbx() { # aynısı, santralin logunda
  local o="$LOG"; LOG="$W/pbx/log/messages.log"; expect "$@"; LOG="$o"
}
sql() { (cd "$REPO/server" && node -e "const {DatabaseSync}=require('node:sqlite');const r=new DatabaseSync(process.argv[1]).prepare(process.argv[2]).all();console.log(r.map(x=>Object.values(x).join('|')).join('\n'))" "$DB_PATH" "$1"); }

for _ in $(seq 30); do [[ "$(A 'pjsip show registrations' | grep -c Registered)" -ge 2 ]] && break; sleep 0.5; done
echo "== Kayıt (şifreli bağlantı)"
if A 'pjsip show registrations' | grep -q 'verimor-reg.*Registered'; then echo "  ✓ verimor operatöre kayıtlı"; else echo "  ✗ verimor kayıt olmadı"; A 'pjsip show registrations'; FAIL=1; fi

echo "== Gelen: kayıtlı müşteri, danışmanın TT hattını arıyor (4 kanal) → danışmanın cebi, aynı bağlantıdan"
call 03122191672-topbx_tt-05464962638
expect "cep 0532 112 22 33 aranır, TT bağlantısından, hat 0'lı biçimde görünür" "E2E-IN to=05321112233 from=03122191672 pai=<sip:03122191672@127.0.0.3> via=127.0.0.3:5070"
expect "görüşme kuruldu" "E2E-RESULT 03122191672-topbx_tt-05464962638 ANSWER"
[[ "$(sql "SELECT trunk FROM numbers WHERE did='+903122191672'")" == "tt" ]] && echo "  ✓ hattın bağlantısı öğrenildi: tt" || { echo "  ✗ hattın bağlantısı öğrenilmedi"; FAIL=1; }

echo "== Gelen: kayıtsız müşteri, Netgsm hattını arıyor (1 kanal) → asistan, danışman bağlantısından"
call 905337435628-topbx_netgsm-05551234567
expect "asistan 0531 281 44 23 aranır, Netgsm'den, hat 10 hane" "E2E-IN to=05312814423 from=5337435628 pai=<sip:5337435628@127.0.0.2> via=127.0.0.2:5070"

echo "== Gelen: + ile gelen numara da tanınır"
call +903122191672-topbx_tt-05464962638
expect "+90 ile gelen arama danışmana gider" "E2E-RESULT +903122191672-topbx_tt-05464962638 ANSWER"

echo "== Gelen: aynı operatör sunucusundaki iki hesap ayrı tanınır (kayıt üzerinden)"
for _ in $(seq 20); do [[ "$(A 'pjsip show registrations' | grep -c Registered)" -ge 2 ]] && break; sleep 0.5; done
call 8501112244-vm2-05551112233
call 8501112233-vm1-05551112234
expect_pbx "ikinci hesaba gelen arama ikinci bağlantıda" "Gelen arama: 05551112233 -> 8501112244 (bağlantı: verimor2)"
expect_pbx "birinci hesaba gelen arama birinci bağlantıda" "Gelen arama: 05551112234 -> 8501112233 (bağlantı: verimor)"

echo "== Gelen: bizim olmayan numara → açılmadan meşgul"
call 05330000000-topbx_netgsm-05464962638 3
expect "santral açmadı (BUSY)" "E2E-RESULT 05330000000-topbx_netgsm-05464962638 BUSY"
[[ -z "$(sql "SELECT id FROM calls WHERE dialed_number='+905330000000'")" ]] && echo "  ✓ arama kaydı açılmadı" || { echo "  ✗ yabancı arama kaydedildi"; FAIL=1; }

echo "== Giden (panel): Kaan müşteriyi arar → hattı TT'de, müşteri 0312'yi görür"
call 05464962638-asu1-u1
expect "müşteri TT'den aranır, 0312 0'lı biçimde" "E2E-IN to=05464962638 from=03122191672 pai=<sip:03122191672@127.0.0.3> via=127.0.0.3:5070"

echo "== Giden (panel): Merve → hattı Netgsm'de"
call 05551234567-asu2-u2
expect "müşteri Netgsm'den aranır, 5628 görünür" "E2E-IN to=05551234567 from=5337435628 pai=<sip:5337435628@127.0.0.2> via=127.0.0.2:5070"

echo "== Giden (panel): Ahmet → hattı Verimor'da (şifreli bağlantı, 90'lı biçim)"
call 05551234568-asu3-u3
expect "müşteri Verimor'dan aranır, operatöre 850 numarası bildirilir" "E2E-IN to=05551234568 from=vm1 pai=<sip:908501112233@127.0.0.5> via=127.0.0.5:5070"

echo "== Giden: hattın bağlantısı santralde yoksa varsayılan bağlantı"
sql "UPDATE numbers SET trunk='silinmis' WHERE did='+905337435628'" >/dev/null
call 05551234569-asu2-u2
expect "varsayılan (Netgsm) kullanılır" "E2E-IN to=05551234569 from=5337435628 pai=<sip:5337435628@127.0.0.2> via=127.0.0.2:5070"

echo "== Giden: hattın bağlantısı bir tarayıcı kullanıcısı olamaz"
sql "UPDATE numbers SET trunk='u1' WHERE did='+905337435628'" >/dev/null
call 05551234570-asu2-u2
expect "varsayılan (Netgsm) kullanılır, Kaan'ın tarayıcısı çalmaz" "E2E-IN to=05551234570 from=5337435628 pai=<sip:5337435628@127.0.0.2> via=127.0.0.2:5070"

echo "== Giden: eski biçimde kalmış bağlantı eski arayan numara biçimini korur"
sql "UPDATE numbers SET trunk='eski' WHERE did='+905337435628'" >/dev/null
call 05551234571-asu2-u2
expect "arayan 0'lı, PAI 10 hane (eski davranış)" "E2E-IN to=05551234571 from=05337435628 pai=<sip:5337435628@eski.sunucu> via=127.0.0.3:5070"

echo "== Araç: bağlantı silme"
if "$REPO/pbx/trunk.sh" --sil netgsm >/dev/null 2>&1; then echo "  ✗ varsayılan bağlantı silindi"; FAIL=1; else echo "  ✓ varsayılan bağlantı silinemez"; fi
if "$REPO/pbx/trunk.sh" --sil 00-bos >/dev/null 2>&1; then echo "  ✗ geçersiz ad silindi"; FAIL=1; else echo "  ✓ geçersiz ad reddedildi"; fi

echo "== Giden: yurt dışı numara aranamaz"
call 00441234567890-asu1-u1 3
if grep -q "E2E-IN to=00441234567890" "$LOG"; then echo "  ✗ yurt dışı arandı"; FAIL=1; else echo "  ✓ yurt dışı aranmadı"; fi

echo "== Araç: arayan numara testi (cli-test.sh)"
XRE_WAIT=1 XRE_LOG="$W/pbx/log/messages.log" "$REPO/pbx/cli-test.sh" 0312 219 16 72 05321110000 tt >/dev/null || true
XRE_WAIT=1 "$REPO/pbx/cli-test.sh" 03122191672 05321110000 tt >/dev/null
expect "test araması TT'den, hat 0'lı biçimde" "E2E-IN to=05321110000 from=03122191672 pai=<sip:03122191672@127.0.0.3> via=127.0.0.3:5070"
if "$REPO/pbx/cli-test.sh" 03122191672 00441234567 >/dev/null 2>&1; then echo "  ✗ yurt dışı test araması kabul edildi"; FAIL=1; else echo "  ✓ yurt dışı test araması reddedildi"; fi

echo "== Araç: sağlık kontrolü (doctor.sh)"
if XRE_LOG="$W/pbx/log/messages.log" "$REPO/pbx/doctor.sh" > "$W/doctor.txt" 2>&1; then echo "  ✓ doctor.sh sorun bulmadı"; else echo "  ✗ doctor.sh:"; sed 's/^/      /' "$W/doctor.txt"; FAIL=1; fi
for want in "netgsm: erişilebilir (1 kanal, biçim 10, numara 8503465993)" "tt: erişilebilir (4 kanal, biçim 0" "verimor: kayıtlı, erişilebilir (2 kanal, biçim 90" "arama 'bize ait değil' diye reddedildi"; do
  grep -qF "$want" "$W/doctor.txt" && echo "  ✓ doctor: $want" || { echo "  ✗ doctor çıktısında yok: $want"; FAIL=1; }
done
A 'pjsip send unregister verimor-reg' >/dev/null; sleep 1
B 'pjsip show aor vm1' >/dev/null
printf '%s\n' 2 127.0.0.5:5070 1 "" 8501112233 2 90 vm1 yanlissifre | "$REPO/pbx/trunk.sh" verimor >/dev/null
sleep 2
if XRE_LOG="$W/pbx/log/messages.log" "$REPO/pbx/doctor.sh" > "$W/doctor2.txt" 2>&1; then echo "  ✗ yanlış şifre fark edilmedi"; FAIL=1
else grep -q "verimor: operatöre kayıt olamadı" "$W/doctor2.txt" && echo "  ✓ yanlış şifre fark edildi" || { echo "  ✗ yanlış şifre mesajı yok:"; sed 's/^/      /' "$W/doctor2.txt"; FAIL=1; }; fi

echo "== Uygulama kayıtları"
sleep 2
ROWS="$(sql "SELECT direction, dialed_number, status FROM calls ORDER BY id")"
echo "$ROWS" | sed 's/^/    /'
N="$(echo "$ROWS" | grep -c 'completed' || true)"
[[ "$N" -ge 11 ]] && echo "  ✓ $N görüşme tamamlandı olarak kaydedildi" || { echo "  ✗ tamamlanan görüşme sayısı: $N"; FAIL=1; }
# Bizim ayarlarımızdan kaynaklanan uyarılar (dialplan sözdizimi, PJSIP ayarı, fonksiyon hataları) testi bozar
if grep -E "ERROR|WARNING" "$W/pbx/log/messages.log" \
  | grep -E "pbx_config|config\.c|res_pjsip/|res_sorcery_config|chan_pjsip|func_|app_dial|pbx\.c" \
  | grep -vE "Unable to load config file|Declined modules|Hattın bağlantısı santralde yok|endpoint .silinmis." > "$W/warn.txt"; then
  echo "== Santral ayar uyarıları:"; sed 's/^/    /' "$W/warn.txt" | tail -20; FAIL=1
fi
[[ "$FAIL" == "0" ]] && echo "== TÜMÜ GEÇTİ" || { echo "== BAŞARISIZ (KEEP=1 ile tekrar çalıştırıp $W altındaki logları inceleyin)"; exit 1; }

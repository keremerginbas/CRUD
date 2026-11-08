# Numara maskeleme: plan ve uygulama kılavuzu

Amaç: müşteri danışmanın kişisel numarasını hiçbir zaman görmez. Müşteri şirkete ait bir numarayla
aranır; müşteri o numarayı geri aradığında arama doğru danışmana (ya da asistana) gelir. Görüşmeler
kaydedilir. Satış hatları Bitrix'te kalır.

## Nasıl çalışıyor

```
                       ┌──────── Operatör bağlantıları (aynı anda birden fazla) ────────┐
Müşteri ◀── telefon ──▶│ netgsm (0850 / 0533)   tt (0312'ler)   verimor ...             │
                       └───────────────────────────┬────────────────────────────────────┘
                                                   │ SIP (internet)
                                     Asterisk santral (CT 150)  ◀── karar ──  Uygulama (CT 140)
                                                   │ WebRTC (wss)
                                     Danışmanın paneli (tarayıcı / telefon tarayıcısı)
```

- **Giden arama:** Danışman panelde "Ara"ya basar. Santral uygulamaya bu danışmanın hattını sorar.
  Müşteri, **o hattın bağlı olduğu operatör bağlantısından** ve o hattın numarasıyla aranır. Danışman
  tarayıcıdan konuştuğu için operatöre tek bir arama gider.
- **Gelen arama:** Müşteri hattı arar. Hangi bağlantıdan gelirse gelsin santral uygulamaya sorar:
  - Kayıtlı müşteri ve danışman mesaideyse danışmana gider: panel açıksa panelde, değilse cebinde
    çalar. Danışmanın ekranında şirket hattı görünür.
  - Kayıtsız müşteri, mesai dışı ya da boştaki hat ise asistana (0531 281 44 23) gider.
  - Hat listesinde olmayan numara ise açılmadan "meşgul" döner. Operatör aramayı başka hedefe verir
    ve arama geçmişe yazılmaz.
- **Hangi numara görünür:** Panelde Ekip → Hatlar'da her hattın bir "operatör bağlantısı" vardır.
  Boş bırakılırsa varsayılan bağlantı kullanılır; ilk gelen aramada bağlantı otomatik öğrenilir.
  Santral, bağlantının istediği biçimde (10 hane / 0'lı / 90'lı) arayan numarayı ve
  P-Asserted-Identity başlığını gönderir.

## "Kendi trunk'ımız" ne demek

Santral, yönlendirme, kayıt ve panel tamamen bizim, kendi sunucumuzda. Telefon şebekesine çıkış
(trunk) ise yalnızca BTK yetkili bir Türk operatörden alınabilir. Bu yasal bir zorunluluk.

- **Yurt dışı trunk ile 0850 gösterme olmaz.** 0850 numarasını sadece Türk operatör verir. Yurt
  dışından gelen ve Türk numarası gösteren aramalar operatörlerce filtrelenebilir: arama hiç
  ulaşmayabilir, "+90/uluslararası" görünebilir ya da spam işaretlenebilir. Ayrıca kaçak trafik
  sayılma riski taşır.
- **Görünen numara şirketin olmalı.** Santral teknik olarak her numarayı gönderebilir. Ama operatör
  sadece o bağlantıda tanımlı ya da adınıza kayıtlı ve izin verdiği numaraları gösterir. Başkasının
  numarasını göstermek yasal değildir; sistem bunu yapmaz.

## Operatörden ne istenecek

Netgsm, Verimor ve Türk Telekom'a aynı soruları sorun. Hangisi uygunsa o; birden fazlası da aynı anda
bağlanabilir.

1. "Kendi Asterisk santralimize bağlanacak **SIP trunk** istiyoruz. Bitrix dahililerimizden
   **bağımsız** olacak; hiçbir departmana, kuyruğa ya da IVR'a eklenmeyecek."
2. "Bu trunk'a hangi numaralar bağlanabilir? 0850, mevcut 0312 numaralarımız (numara taşıma), 444
   24 53?" Her numara aynı bağlantıya **DID** olarak gelirse en temiz çözüm budur.
3. "Aynı anda kaç görüşme (kanal)? Kanal ve dakika ücreti?" En az 4 kanal önerilir.
4. "Bağlantı **kullanıcı adı/şifre** ile mi, **IP doğrulama** ile mi?" Bizim sabit IP'miz:
   81.214.28.155.
5. "Giden aramada arayan numara olarak bu trunk'taki **her numarayı ayrı ayrı** gösterebilir miyiz?
   P-Asserted-Identity mi, From mu? Numara hangi biçimde gönderilmeli (5xx, 05xx, 905xx)?"
6. "Adımıza kayıtlı **0533 mobil numaralarımızı** bu trunk'tan arayan numara olarak gösterebilir
   miyiz? Hangi belge gerekir?"
7. "Gelen aramada aranan numarayı (DID) SIP isteğinde iletiyor musunuz?"

Cevaplar `pbx/trunk.sh` sorularıyla bire bir örtüşür. Operatörün verdiği bilgiler santralde girilir,
şifre chat'e yazılmaz.

### Numara planı (yaklaşık 30 numara)

| Numara | Nerede | Öneri |
|---|---|---|
| 444 24 53 | TT | Trunk'a taşınırsa karşılama hattı olur (zaten tanımlı, `hunt`) |
| 17 adet 0312 219 xx xx | TT / fibimi | Aynı TT SIP trunk'ına DID olarak alınır. Her danışmanın bir 0312'si olur, müşteri onu görür |
| 0850 | Netgsm / Verimor / TT | Ortak numara ya da yeni danışmanlar için |
| 0533 743 xx xx (danışman) | Netgsm FCT | Görünmesi operatör iznine bağlı (soru 6). İzin yoksa 0312/0850 kullanılır |
| 0533 743 xx xx (satış) | Netgsm, Bitrix | **Dokunulmaz** |

## Sabah kılavuzu

Her komutun hangi makinede çalışacağı başında yazıyor.

### 0. Güvenlik önkoşulu: gerçek müşteri aramaları santrale düşmesin

Netgsm panelinde santralin kullandığı dahililer (119 ve 114) hiçbir **departmanda, kuyrukta, IVR'da,
Gelen Çağrı yönlendirmesinde** olmamalı. Önce bunları çıkarın. Santral bize ait olmayan aramayı zaten
açmadan reddediyor; ama Netgsm'in aramayı diğer dahililere vermesi gecikmeye yol açar.

### 1. Kodu güncelle

**Makine: root@pve**
```bash
pct exec 140 -- /opt/santral/server/deploy/update.sh
pct exec 150 -- bash -c 'cd /opt/santral && git pull -q && pbx/install.sh'
```
Santral kapalıysa `install.sh` onu kapalı bırakır. 0. adım bittiyse açmak için:
```bash
pct exec 150 -- bash -c 'START=1 /opt/santral/pbx/install.sh'
```

### 2. Mevcut Netgsm bağlantılarını yeni biçimde yeniden yaz

**Makine: root@santral** (`pct enter 150`)
```bash
/opt/santral/pbx/trunk.sh trunk   # Netgsm 119: operatör 1, sunucu sip8.netsantral.com, numara 5337437589, kanal 1, biçim 10
/opt/santral/pbx/trunk.sh agent   # Netgsm 114: numara 5337435680 (danışmanı arayan, gelen arama açmaz)
```
Şifreyi ekranda görünmeden siz girersiniz. Netgsm dahilisi tek kanallıdır.

### 3. Uygulama ile santrali bağla ve kontrol et

**Makine: root@pve**
```bash
pct exec 150 -- cat /opt/santral/pbx/connect.sh | bash
pct exec 150 -- /opt/santral/pbx/doctor.sh
```
`doctor.sh` her maddeyi ✓ / ✗ ile gösterir. "bize ait değil diye reddedildi" uyarısı çıkarsa 0. adıma
dönün.

### 4. Müşteri hangi numarayı görecek: kendi telefonunuzla deneyin

**Makine: root@santral**
```bash
/opt/santral/pbx/cli-test.sh 05337437589 05XXXXXXXXX trunk   # hat, KENDİ cebiniz, bağlantı
```
Ekranda görünen numara müşterinin göreceği numaradır. Bağlantının ana numarası görünüyorsa operatör
o hattın gösterilmesine izin vermiyor demektir; 5. soruyu sorun.

### 5. Yeni trunk geldiğinde (ör. Türk Telekom 0312'ler)

**Makine: root@santral**
```bash
/opt/santral/pbx/trunk.sh tt      # operatör 3, sunucu/IP, kanal sayısı, biçim
/opt/santral/pbx/doctor.sh
/opt/santral/pbx/cli-test.sh 03122191672 05XXXXXXXXX tt
```
Panelde **Ekip → Hatlar**'da 0312 hatlarının "Operatör bağlantısı" kutusuna `tt` yazın. Ya da ilk gelen
aramayı bekleyin; bağlantı otomatik öğrenilir. TT'yi varsayılan yapmak için:
`pct exec 150 -- cat /opt/santral/pbx/connect.sh | TRUNK=tt bash` (makine: root@pve).

Bir bağlantıyı kaldırmak için: `/opt/santral/pbx/trunk.sh --sil tt`

## Sorun giderme

| Belirti | Bakılacak yer |
|---|---|
| Müşteri bağlantının ana numarasını görüyor | Operatör hat başına numara göstermeye izin vermiyor ya da biçim yanlış. `trunk.sh <ad>` ile biçimi (10/0/90) değiştirip `cli-test.sh` ile tekrar deneyin |
| Arama hiç çıkmıyor, `doctor.sh` "kayıt olamadı" diyor | Kullanıcı adı/şifre ya da sunucu. `trunk.sh <ad>` ile yeniden girin |
| "operatöre ulaşılamıyor" | Modemde UDP 5060 ve 10000-10200 → 192.168.1.247, SIP ALG kapalı |
| Ses tek yönlü / yok | SIP ALG, port yönlendirme, `rtp.conf` dış IP |
| İkinci arama meşgul (503) | Bağlantı tek kanallı (Netgsm dahilisi). Çok kanallı trunk alın; `trunk.sh` kanal sayısını sorar |
| Şirketin başka aramaları asistana düşüyor | 0. adım: dahililer Netgsm departman/kuyruk/IVR'dan çıkarılmalı |

## Geliştirici notu: uçtan uca test

`pbx/test/e2e.sh`, santral ayarlarını gerçek Asterisk ile dener. Operatör yerine ikinci bir Asterisk,
karar için de gerçek uygulama kullanılır. Test edilenler: üç operatör aynı anda (biri şifreli kayıtlı),
her hattın kendi bağlantısından ve doğru biçimde çıkması, gelen aramanın doğru kişiye gitmesi,
yabancı aramanın reddi, yurt dışı engeli, `doctor.sh` ve `cli-test.sh`. Santral sunucusunda değil,
geliştirme makinesinde çalıştırılır (`apt-get install asterisk`).

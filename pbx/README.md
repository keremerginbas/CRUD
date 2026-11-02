# Santral (Asterisk) kurulumu

```
Operatör SIP trunk ◀──▶ Asterisk (CT 150, 192.168.1.247) ◀──▶ Uygulama (CT 140, 192.168.1.253)
```

- Gelen arama `from-trunk` dialplan'ına düşer; Asterisk uygulamaya "kime gitsin?" diye sorar
  (`/webhooks/pbx/route`), cevaba göre danışmanı ya da asistanı arar, kaydı başlatır.
- Paneldeki "Ara" düğmesi ARI ile önce danışmanın cebini arar, açınca `xre-click2call`
  müşteriyi danışmanın hattından arar.
- Kapanışta `xre-hangup` sonucu uygulamaya bildirir (`/webhooks/pbx/event`).
- Kayıtlar `/var/spool/asterisk/recording` altındadır, uygulama ARI üzerinden indirir.

## Güvenlik
- Santrale hiçbir telefon kayıt olamaz; tek SIP bağlantısı operatör trunk'ıdır.
- SIP yalnızca iç ağdan ve operatörün adreslerinden kabul edilir (`pjsip.conf` → `[acl]`).
- Dialplan yalnızca `0[2-5]XXXXXXXXX` biçimindeki Türkiye numaralarını arar; yurt dışı kapalı.
- ARI (8088) ve uygulama (3000) modemde dışarı açılmaz.

## Adımlar (Proxmox kabuğunda)
1. Konteyner + kurulum: CT 150 açılır, depo klonlanır, `pbx/install.sh` çalışır (derleme 10-20 dk).
2. Bağlantı: `pct exec 150 -- cat /opt/santral/pbx/connect.sh | bash`
3. Trunk: `pct enter 150` → `/opt/santral/pbx/trunk.sh`. Kullanıcı adı/şifreyle kayıt ya da IP doğrulama
   desteklenir. Satışçı hatları Bitrix'te kaldığı için Bitrix/Vapi'nin kullandığı Netgsm hesabı kullanılmaz;
   444 ve 0312 hatları için Türk Telekom'dan (ya da numaralar taşınırsa Netgsm'den) ayrı trunk alınır.
4. Modem: UDP 5060 ve UDP 10000-10200 → 192.168.1.247.

## Anonslar
`pbx/sounds.sh` bunları Türkçe yapay sesle üretir (metinler betiğin içinde). Kendi kaydınızı kullanmak için aynı adla 8 kHz mono WAV dosyasını `/var/lib/asterisk/sounds/custom/` altına koyun; dosya yoksa anons sessizce atlanır:
- `xre-danismaninizi-ariyorsunuz.wav` — gelen aramada, danışmana bağlanan müşteriye
- `xre-kayit-bilgisi.wav` — gelen aramada, asistana giden müşteriye (KVKK kayıt bilgisi)
- `xre-musteriniz-ariyor.wav` — gelen aramada danışmana, bağlanmadan önce
- `xre-musterinize-baglaniyorsunuz.wav` — "Ara" düğmesinde danışmana
- `xre-danismaniniz-ariyor.wav` — "Ara" düğmesinde müşteriye

## Kontrol komutları (CT 150 içinde)
```bash
asterisk -rx 'pjsip show registrations'   # operatör kaydı (şifreli yöntemde)
asterisk -rx 'core show channels'         # süren aramalar
tail -f /var/log/asterisk/messages.log    # canlı log
```

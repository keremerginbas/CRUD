# XRE Mesai (native CRM)

XRE CRM içindeki Mesai ekranı, yüklenen XRE Mesai arayüzünün **ihtiyaç, yemek ve online randevu** akışını Manus oturumu ve XRE kalıcı store katmanına taşır. Eski PHP çalıştırılmaz; CRM sunucusunda yeni `/api/worktime` route modülü kullanılır.

## Kapsam

- Mesaiyi başlatma, ihtiyaç/yemek/online randevu molası, mesaiye dönme ve bitirme.
- Aynı gün bitirdikten sonra yeniden başlama; önceki dönemler korunur.
- Sunucu damgalı dönemler: `work`, `need`, `meal`, `appointment`.
- Türkiye günü (`Europe/Istanbul`, UTC+3) ile tam gün state'i.
- 8 saat net çalışma hedefi, net çalışma/mola toplamları, akış çizelgesi ve geçmiş gün raporu.
- Yetkili owner veya `worktime` için `scope: "all"`, `read: true` grant'i olan kullanıcı için ekip raporu.
- Aynı `operationId` tekrarında kalıcı idempotency; aynı geçiş ikinci kez uygulanmaz.

## Route kurulumu

`server/worktime.ts` içindeki `registerWorktimeRoutes(app, store)` fonksiyonu, Express JSON parser'ından ve doğrulanmış `req.auth` middleware'inden sonra çağrılır. Route modülü ayrıca `req.auth` yoksa kapalı davranır; istemciden gelen `employeeId`, `openId` veya owner bilgisine güvenmez.

```ts
registerWorktimeRoutes(app, store);
```

## API

### `GET /api/worktime`

Oturumdaki doğrulanmış `req.auth.user.openId` için döner:

```json
{
  "timezone": "Europe/Istanbul",
  "today": {
    "day": "2026-10-13",
    "userOpenId": "verified-session-user",
    "status": "working",
    "version": 1,
    "periods": [{ "startAt": "...", "endAt": null, "type": "work" }],
    "totals": { "netMs": 3600000, "networkMs": 3600000, "breakMs": 0 }
  },
  "history": [],
  "summary": { "targetMs": 28800000, "progressPercent": 13 },
  "previousOpen": null
}
```

`day` veya `today` query parametresi, rapor görünümünde okunacak günü seçmek için kabul edilir. Okuma yine yalnızca oturum kullanıcısının kayıtlarıyla sınırlıdır.

### `POST /api/worktime/transition`

```json
{
  "action": "start | pause | resume | finish",
  "pauseType": "need | meal | appointment",
  "operationId": "UUID",
  "expectedVersion": 3,
  "location": {
    "lat": 41.01,
    "lng": 28.97,
    "accuracy": 40,
    "capturedAt": "2026-10-13T08:00:00.000Z"
  },
  "optionalPermissionProvided": true
}
```

- `operationId` istek anahtarıdır; istemci hata aldıysa aynı UUID ile güvenle tekrar deneyebilir.
- `expectedVersion` optimistic concurrency kontrolüdür. Uymazsa `409 VERSION_CONFLICT` döner.
- Konum yalnızca açıkça gönderilirse saklanır; otomatik izleme veya arka plan GPS yoktur.
- Ağ hatası için istemci sahte/yerel “onaylı” state üretmez ve phantom offline shift kuyruğa koymaz.
- Başarılı yanıtta `today`, `history`, `summary` ve uygulanan `state` bulunur.

### `GET /api/worktime/team`

`from`, `to` veya tek `date` query parametreleriyle en fazla 32 günlük aralık döner. Yalnızca:

1. owner hesabı, veya
2. doğrulanmış auth içindeki `permissions.worktime.read === true` ve `permissions.worktime.scope === "all"`

erişebilir. `scope: "own"` kullanıcılarının kendi vardiyası çalışır ancak ekip endpoint'i `403` döner.

## Kalıcılık ve yarış kontrolü

Her vardiya gününün state'i `worktime` record kind'ında şu anahtarla saklanır:

```text
{verifiedUserOpenId}:{turkeyDay}
```

Payload içinde `userOpenId`, `creatorOpenId`, `day`, `version` ve `periods` bulunur. Her geçiş ayrıca `xre_events` üzerinden `worktime:{userOpenId}:operation:{operationId}` event key'iyle immutable event olarak claim edilir. State, event'lerin sıralı reducer'ıyla yeniden kurulabilir; gün state'i yalnızca hızlı okuma snapshot'ıdır.

- MemoryStore testlerinde kullanıcı başına process kuyruğu vardır.
- `MysqlStore` ile `DATABASE_URL` varsa process kuyruğuna ek olarak MySQL `GET_LOCK` / `RELEASE_LOCK` kullanılır; kilit ayrı bağlantıda alınıp `finally` içinde bırakılır.
- Aynı operation iki worker'a ulaşsa bile event unique key'i tek geçiş üretir.
- State version ve geçiş doğrulaması kilit içinde yapılır.

## Gece yarısı davranışı

Açık shift bir sonraki Türkiye gününe taşınmaz ve eski gün silinmez. Yeni günde `start`, `pause` veya `resume` denemesi `409 PREVIOUS_DAY_OPEN` verir. `finish` isteği günü belirtilmemişse en son açık eski günü bitirir. Böylece önceki gün görünür kalır ve yeni gün yanlışlıkla sıfırlanmaz.

## Kaynak incelemesi ve sınırlar

Yüklenen `source-review/mesai` içindeki değişiklik notları ve native ekran akışı incelendi. Eski PHP endpoint'i, PIN/auth sistemi, Bitrix, Telegram ve dış bot çağrıları CRM'e taşınmadı. ZIP içinde `config.php`, SQLite veri dosyası veya güvenilir eski kayıt import şeması bulunmadığı için eski kayıtlar otomatik import edilmez. Kimlik doğrulama Manus oturumu olarak kalır; yeni şifre, PIN veya credential eklenmez.

Kaynakta bulunan eski bildirim ve entegrasyon özellikleri için bu native core herhangi bir otomatik dış çağrı yapmaz. Bitrix/Telegram entegrasyonu ayrıca yapılandırılmadıkça devre dışıdır.

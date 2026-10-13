# Google Meet / Google Calendar (CRM içi)

Bu entegrasyon Manus Google Calendar connector kullanmaz. CRM, kullanıcının kendi Google OAuth client'ı ile `calendar.events` kapsamına bağlanır ve yalnızca kullanıcının kendi hesabında etkinlik oluşturur.

## Kurulum

Aşağıdaki sunucu değişkenleri **sunucuda** tanımlanmalıdır; tarayıcıya gönderilmez:

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `GOOGLE_CALENDAR_TOKEN_KEY`: base64 kodlu tam 32 byte anahtar

`GOOGLE_CALENDAR_REDIRECT_URI` sabit ve HTTPS olmalı, tam olarak `/api/google-calendar/callback` yolunu kullanmalıdır. Google Cloud Console'da aynı URI OAuth istemcisinin authorized redirect URI değeri olarak kaydedilmelidir. Değişkenlerden biri eksik/uygunsuzsa `GET /api/google-calendar/status` şu durumu bildirir:

```json
{ "configured": false, "connected": false, "setupRequired": true }
```

Örnek anahtar üretimi:

```bash
openssl rand -base64 32
```

## OAuth güvenliği

- Bağlantı başlatma `POST /api/google-calendar/connect` ile, mevcut Manus oturumunda ve güvenilir browser `Origin` başlığıyla yapılır.
- Bağlantı ve callback, doğrudan monte edilmiş olsalar bile `calendar.write` yetkisini kontrol eder; callback token değişiminden önce bu kontrolden geçer.
- OAuth state kriptografik olarak rastgeledir; 10 dakika geçerlidir, `HttpOnly; SameSite=None; Secure` cookie ile tarayıcıya bağlanır ve private raw store'da kullanıcı/owner ile eşleştirilir.
- Callback mevcut Manus authentication middleware'inden geçer. State başka kullanıcıya veya owner'a aitse, süresi dolmuşsa ya da cookie eşleşmiyorsa reddedilir.
- Access ve refresh tokenlar AES-256-GCM ile şifrelenir. Raw token hiçbir API yanıtına, istemci state'ine veya log'a yazılmaz. Private hesap kaydı `sha256(user.openId)` anahtarıyla tutulur.
- Yenileme ve Calendar istekleri yalnızca `oauth2.googleapis.com` veya `www.googleapis.com` HTTPS hostlarına, redirect kapalı ve timeout'lu gönderilir.
- Hesap silme/disconnect uç noktası bu sürümde yoktur.

## Meeting API

`POST /api/meetings` girişi strict Zod şemasıdır:

```json
{
  "requestId": "UUID",
  "leadId": "crm-lead-id",
  "title": "Görüşme",
  "date": "2030-10-13",
  "time": "11:00",
  "durationMinutes": 60,
  "assignee": "Danışman",
  "attendees": ["musteri@example.com"],
  "description": "Not",
  "sendInvites": false,
  "provider": "google"
}
```

`date` gerçek takvim günü, `time` Türkiye saati (`Europe/Istanbul`, UTC+03:00) ve başlangıç gelecekte olmalıdır. `durationMinutes` 15–240 arasındadır. `sendInvites` varsayılan olarak `false` kabul edilir; Google etkinliği buna göre `sendUpdates=none` veya kullanıcı açıkça onay verdiyse `sendUpdates=all` ile eklenir.

`provider: "manual"` için `meetingUrl` zorunlu ve yalnızca şu biçimdedir:

`https://meet.google.com/abc-defg-hij`

Bu biçim dışındaki sahte/uydurulmuş bağlantılar kabul edilmez. Google sağlayıcısında istemcinin verdiği bağlantı kabul edilmez; bağlantı Google Calendar `conferenceData` sonucundan alınır.

## İdempotency ve belirsiz sonuç

CRM önce owner/user bağlamı, lead kapsamı ve `activities` yazma iznini doğrular. Google toplantısında yapılandırma ve bağlı hesap, intent kaydı yazılmadan önce doğrulanır; setup/account eksikliği aynı UUID'nin daha sonra yeniden denenmesini engelleyen başarısız bir intent bırakmaz. Geçerli istekte private raw store'a input fingerprint içeren meeting intent yazılır. Google event id, owner + kullanıcı + `requestId` üzerinden SHA-256 ile deterministiktir ve Google'ın izin verdiği base32hex karakter kümesinde harfle başlar. Manuel sağlayıcıda activity id de kullanıcı + `requestId` üzerinden deterministiktir. Aynı `requestId` farklı içerikle tekrar kullanılırsa conflict döner.

Google etkinliği `conferenceDataVersion=1` ile ve benzersiz conference request id ile oluşturulur. `conferenceData.createRequest.status` nesne biçiminde gelse bile yalnızca doğrulanmış gerçek bir `https://meet.google.com/abc-defg-hij` URL'si `ready` sayılır; status `success` tek başına yeterli değildir. Timeout/abort/transport sonucu **unknown/pending** olarak saklanır; otomatik olarak ikinci insert gönderilmez. 409 durumunda aynı event id GET edilerek mevcut etkinlik kurtarılmaya çalışılır.

Bilinen bir Google HTTP hatası başarılı toplantı gibi `201` dönmez; CRM'de mevcutsa `failed` activity işaretlenebilir ve API başarısız HTTP status döndürür. CRM activity yazımı provider insert'inden sonra belirsizleşirse intent `unknown/pending` kalır ve sonraki GET provider event'ini kurtarmayı dener.

Manuel meeting tekrar gönderimi mevcut activity eksikse aynı deterministik id ile activity'yi onarır. Activity yazılmadan başarılı (`ready`) yanıt verilmez; geçici CRM yazma hatası request UUID'sini kullanılamaz hale getirmez.

Yanıt yalnızca CRM verisini döndürür:

```json
{
  "activity": { "id": "activity-meeting-...", "meetingUrl": "https://meet.google.com/..." },
  "conferenceStatus": "ready",
  "meetingUrl": "https://meet.google.com/...",
  "message": "..."
}
```

`conferenceStatus` `ready`, `pending` veya `failed` olabilir; ham Google response/token döndürülmez. `GET /api/meetings/:requestId`, pending conference bilgisini Calendar'dan kontrol eder ve bulunan gerçek bağlantıyla scoped `activities` kaydını günceller.

Her lead okuması ve `activities` scoped write preflight'ı Google'a giden her dış isteğin hemen öncesinde yeniden yapılır. Böylece permission değişimi veya lead kapsamı kaybı halinde dış etkinlik çağrısı yapılmaz.

## Referanslar

- [Google Calendar: Create events](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Google Calendar Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)

# CRM v3 — Suite backend sözleşmesi

Bu sürüm, mevcut owner-only Manus oturumunu ve `xre_records` / `xre_events` persistence katmanını korur. Yeni suite kayıtları owner kapsamına göre saklanır; `members` yalnızca ekip dizinidir ve **auth yetkisi veya hesap oluşturmaz**.

## State

Kimliği doğrulanmış owner için `GET /api/state` mevcut alanlara ek olarak aşağıdaki dizileri döndürür:

```json
{
  "contacts": [],
  "companies": [],
  "pipelines": [],
  "tasks": [],
  "activities": [],
  "feed": [],
  "members": []
}
```

İlk state'te backend pipeline seed etmez. `sales` varsayılanı frontend'de sanal pipeline'dır; ilk kayıt edilene kadar `pipelines` içinde görünmez. Saklanan task'lar `dueAt` artan, boş tarihler sonda olacak şekilde döner.

Tüm suite kayıtlarında `id`, `createdAt` ve `updatedAt` string'dir. Zaman alanları ISO-8601'dir; oluşturma ve güncelleme timestamp'lerini server üretir. PATCH ile `id`, `createdAt` ve `updatedAt` değiştirilemez.

## CRUD uçları

Aşağıdaki çoğul uçlar raw entity body kabul eder:

- `POST /api/contacts`, `PATCH /api/contacts/:id`
- `POST /api/companies`, `PATCH /api/companies/:id`
- `POST /api/pipelines`, `PATCH /api/pipelines/:id`
- `POST /api/tasks`, `PATCH /api/tasks/:id`
- `POST /api/activities`, `PATCH /api/activities/:id`
- `POST /api/feed`, `PATCH /api/feed/:id`
- `POST /api/members`, `PATCH /api/members/:id`

DELETE intentionally yoktur. Başarılı POST `201`, PATCH `200` döndürür. Kayıt yoksa `404`; Zod/alan doğrulama hatası `400`; duplicate `409` döndürür. Hatalar `{ error, message }` biçimindedir.

Bu backend sürümünde ayrıca bir bulk lead endpoint'i yoktur; frontend toplu işlemleri aynı owner kapsamındaki sıralı lead PATCH çağrılarıyla yapar. Böylece her aşama değişiminde mevcut stage-rule ve event davranışı korunur.

### Entity alanları

- **Contact:** `name`, `phone`, `email`, `companyId`, `owner`, `tags`, `notes`
- **Company:** `name`, `industry`, `phone`, `email`, `website`, `address`, `owner`, `notes`
- **Pipeline:** `name`, `description`, `stages`; stage id'leri tam olarak `new`, `contacted`, `qualified`, `proposal`, `won`, `lost` olmalı, her biri bir kez bulunmalı ve renkler `#RRGGBB` olmalı. Label ve renkler değiştirilebilir.
- **Task:** `title`, `description`, `status` (`todo|progress|done`), `priority` (`low|normal|high`), `assignee`, `leadId`, `dueAt` (ISO veya boş), `checklist`
- **Activity:** `leadId`, `type` (`call|meeting|task`), `title`, `description`, `startAt`, `endAt`, `assignee`, `completed`; `endAt >= startAt` zorunludur.
- **FeedPost:** `author`, `text`, `leadId`, `likes`, `comments`; PATCH likes/comments listesini kontrollü olarak günceller.
- **Member:** `name`, `email`, `title`, `department`, `status` (`active|away`)

Email boş bırakılabilir; gönderilmişse basit e-posta biçimi doğrulaması yapılır. Metin alanları uzunluk sınırlarına tabidir.

## Scope ve duplicate kuralları

- Contact `companyId`, task/activity/feed `leadId`, lead `contactId`/`companyId`/`pipelineId` yalnızca aynı owner'ın kayıtlarına bağlanabilir.
- `sales` pipeline id'si sanal olarak kabul edilir; başka bir pipeline id'si önce aynı owner'a kaydedilmiş olmalıdır.
- Contact telefon ve e-posta karşılaştırması normalize edilir; boş değer duplicate sayılmaz. Çakışma `409` döndürür.
- Company adları Unicode normalize edilip trim/boşluk ve küçük harf karşılaştırmasıyla duplicate kontrol edilir; çakışma `409` döndürür.
- Hiçbir suite route'u owner-only auth politikasını genişletmez.

## Lead ve otomasyon uyumluluğu

Lead şeması `pipelineId`, `contactId`, `companyId`, `dealTitle`, `expectedCloseDate`, `probability`, `customFields`, `lostReason` ve `lostReasonDetail` alanlarını kabul eder. Güncellemede bunlar ve tanımlı ek lead alanları kaybolmaz. Lead bağlantıları da owner scope içinde doğrulanır.

Rule üzerinde opsiyonel `pipelineId` bulunur. `all` her pipeline'a, boş/olmayan değer genel aşama kuralına, belirli id ise ilgili pipeline'a uygulanır; sanal `sales`, pipeline id'si boş lead'lerle de eşleşir.

`action: "task"` outbox işlemi artık gerçek `tasks` kaydı üretir. Task id'si `task-event-<eventId>` biçiminde event'e bağlı ve retry'larda stabildir; lead, assignee, `dueAt`/`dueHours` ve rule config'i taşınır. `dueHours` 1–720 aralığında değilse 24 saat varsayılır. Event sonucu task id, dueAt ve assignee ile saklanır; dış servis çağrısı yapılmaz.

Suite oluşturma/güncelleme işlemleri `xre_events` içinde Türkçe başlık/detail taşıyan tamamlanmış audit event'i üretir. Mevcut webhook, mesaj, çağrı, auth ve outbox davranışı korunur.

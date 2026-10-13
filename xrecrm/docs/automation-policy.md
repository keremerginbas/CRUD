# Otomasyon politikası

Otomasyon kuralının `policy` alanı, bir aşama geçişinden sonra aksiyonun çalışıp çalışmayacağını ve ne zaman kuyruğa alınacağını tanımlar. Politika saf değerlendirilir; sağlayıcı çağrısı, kayıt yazımı veya mesaj gönderimi yapmaz.

## Geriye dönük varsayılan

`policy` alanı olmayan mevcut kurallar değişmez:

```json
{
  "mode": "all",
  "conditions": [],
  "delayMinutes": 0,
  "businessHours": false
}
```

Bu varsayılan **koşulsuz ve hemen** çalışır. `server/types.ts` içindeki `RuleSchema`, paylaşılan `AutomationPolicySchema` ile doğrulama yapar. Politika ve koşul nesneleri strict'tir: bilinmeyen anahtarlar reddedilir. Değerlendirici hiçbir alan adını dinamik olarak okumaz ve hiçbir ifade/kod çalıştırmaz.

## Şema

| Alan | Değerler | Açıklama |
| --- | --- | --- |
| `mode` | `all` / `any` | Birden çok koşulda AND / OR davranışı |
| `conditions` | En fazla 50 koşul | Her koşul `field`, `op`, isteğe bağlı `value` taşır |
| `delayMinutes` | `0` veya `10..10080`, tamsayı | Geçiş zamanından itibaren dakika; 1–9 ve 10080 üzeri reddedilir |
| `businessHours` | boolean | Çalışma zamanını Türkiye iş saatlerine taşır |

İzin verilen alanlar:

- Metin alanları: `city`, `source`, `owner`, `phone`, `email`
- Sayısal alan: `value`
- Etiket alanı: `tags` (dizi; `contains` en az bir etikette arama yapar)

İzin verilen karşılaştırmalar:

- Metin/etiket: `eq`, `neq`, `contains`, `isEmpty`, `isNotEmpty`
- `value`: `eq`, `neq`, `gte`, `lte`, `isEmpty`, `isNotEmpty`

Metin karşılaştırmaları trim edilir ve Türkçe küçük harfe çevrilerek karşılaştırılır. Etiket `eq` bir etiketin tam eşleşmesini, `contains` ise bir etiketin alt dize eşleşmesini arar. Sayısal koşullar yalnızca sonlu sayıları kabul eder.

## Saf değerlendirme

```ts
import { evaluateAutomationPolicy } from "../shared/automation-policy.js";

const result = evaluateAutomationPolicy(rule, lead, transitionAt);
// { eligible, reason, runAt, conditionResults }
```

`transitionAt` bir `Date`, ISO tarih metni veya epoch milisaniyesi olabilir. `runAt` ISO UTC metnidir; `eligible: false` olduğunda `runAt: null` döner. Gecikme her zaman **aşama geçişi** zamanından hesaplanır, değerlendirme/worker zamanından değil. `planAutomationRule` ayrıca `active` ve `policyEligible` alanlarını taşır; pasif bir kural için `eligible: false`, `runAt: null` ve açıkça `Kural pasif; çalışmayacak.` nedeni döner.

Türkiye mesai hesabı açıkça sabit UTC+03 üzerinden yapılır; sunucunun yerel timezone'u tahmin edilmez. Mesai aralığı pazartesi–cuma 09:00–18:00'dır. Aday zaman aralığın dışındaysa bir sonraki hafta içi 09:00'a taşınır. Örneğin cuma 17:55'te 10 dakika gecikmeli iş pazartesi 09:00 Türkiye saatine planlanır.

## Sunucu yardımcıları

`server/automation-planning.ts` aşağıdaki sözleşmeleri sağlar:

```ts
planAutomationRule(rule, lead, transitionAt): AutomationPlan
```

Kural ve müşteri üzerinde hiçbir store/provider yan etkisi olmadan `{ ruleId, leadId, transitionAt, eligible, reason, runAt, conditionResults }` üretir.

```ts
recheckAutomationPolicyForWorker(
  rule,
  currentLead,
  originalTransitionAt,
  currentAt = new Date(),
): WorkerAutomationPlan
```

Worker'ın güncel kural/müşteri ile koşulları tekrar değerlendirmesi içindir. Orijinal geçiş zamanını kullanır; böylece gecikmeli bir iş worker tarafından yeni bir tarihe ötelenmez. `shouldExecute` false ise provider çağrısı yapılmadan olay atlanmalıdır.

`publicAutomationPlan(plan)` yalnızca dry-run/olay için gerekli plan alanlarını seçer; tam müşteri, kural config'i veya provider kimlik bilgilerini döndürmez.

## Dry-run API

Auth ve modül izin middleware'lerinden sonra `registerAutomationPlanningRoutes(app, scopedStore)` çağrılır ve aşağıdaki endpoint eklenir:

```http
POST /api/automations/dry-run
Content-Type: application/json
```

Kural taslağıyla (test, müşterinin seçili kuralın tetikleme aşamasına girdiğini varsayar):

```json
{
  "rule": {
    "id": "draft-rule",
    "name": "Kadıköy takibi",
    "triggerStage": "new",
    "action": "task",
    "enabled": true,
    "config": {},
    "policy": {
      "mode": "all",
      "conditions": [{ "field": "city", "op": "contains", "value": "kadıköy" }],
      "delayMinutes": 10,
      "businessHours": true
    }
  },
  "leadId": "lead-123"
}
```

Kaydedilmiş kuralla alternatif olarak `{ "ruleId": "rule-123", "leadId": "lead-123" }` gönderilebilir. Kayıtlı kural ve müşteri **scoped store** üzerinden okunur; kapsam dışındaki müşteri için varlık sızıntısını önlemek üzere 404 döner. Dry-run için otomasyon okuma izni yeterlidir. Endpoint yalnızca hesaplar ve plan döndürür: event, rule, lead veya provider kaydı yazmaz; WhatsApp, Vapi, webhook ya da görev dış sistemi çağırmaz.

Yanıt plan alanlarını doğrudan taşır ve `dryRun: true` içerir:

```json
{
  "dryRun": true,
  "ruleId": "draft-rule",
  "leadId": "lead-123",
  "eligible": true,
  "reason": "Koşullar sağlandı.",
  "runAt": "2026-10-19T06:00:00.000Z",
  "conditionResults": [
    { "field": "city", "op": "contains", "value": "kadıköy", "actual": "Kadıköy", "matched": true }
  ]
}
```

## Trigger ve worker akışı

Aşama geçişini kabul eden ana uygulama:

1. Aktif ve aşaması/hunisi eşleşen kuralları bulur.
2. Geçişin değişmez `transitionAt` değerini policy evaluator'a verir.
3. Uygun olmayan policy için idempotent event'i `completed` olarak, `policySkipped`/plan özetiyle kaydeder; kuyruk/provider çağrısı oluşturmaz.
4. Uygun policy için event'i `pending` oluşturur ve `runAt` değerini `nextAttemptAt` olarak ayarlar. Atomik `appendEvent(..., nextAttemptAt)` desteği varsa bunu kullanmak, pending → update yarışını önler.
5. Event payload'ında planın yeniden üretilebilmesi için `transitionAt` ve kural/müşteri kimliklerini saklar.

Worker event'i claim ettiğinde güncel kuralı ve müşteriyi tekrar okur, `recheckAutomationPolicyForWorker` çağırır ve koşul artık sağlanmıyorsa sağlayıcıya gitmeden event'i completed/skipped yapar. Koşullar sağlanıyorsa yalnızca `shouldExecute` true olduğunda mevcut aksiyon yürütülür. Recheck, gecikmeyi worker saatinden tekrar başlatmaz.

## Resmi Bitrix referansları

Bu özellik Bitrix'e özel alan adı veya provider çağrısı eklemez. Dışa aktarım/inbound eşlemesi yapılırken güncel resmi REST referansları kullanılmalıdır:

- [CRM lead alanları](https://apidocs.bitrix24.com/api-reference/crm/leads/crm-lead-fields.html)
- [CRM lead get](https://apidocs.bitrix24.com/api-reference/crm/leads/crm-lead-get.html)
- [CRM lead list](https://apidocs.bitrix24.com/api-reference/crm/leads/crm-lead-list.html)
- [REST API genel kılavuzu](https://apidocs.bitrix24.com/api-reference/rest-complete-guide.html)

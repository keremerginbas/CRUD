# XRE CRM ↔ n8n entegrasyonu

Bu entegrasyon n8n’i CRM’in yerine koymaz. CRM’deki **owner kapsamı**, mevcut outbox/idempotency günlüğü ve doğrulanmış lead kayıtları korunur. n8n yönetim API’si bu uygulamadan yalnızca güvenli özet okumak için çağrılır; workflow oluşturma, etkinleştirme, düzenleme ve silme yapılmaz.

## Sunucu sözleşmesi

`server/n8n.ts` iki ayrı mount fonksiyonu sağlar:

```ts
registerN8nInboundRoute(app, store, async (store, owner, body) => {
  await processInboundWebhook(store, owner, body);
});

app.use(express.json({ limit: "1mb" }));
app.use("/api", requireAuth(store));
registerN8nRoutes(app, store);
```

- `registerN8nInboundRoute` parent uygulamadaki genel JSON parser ve `requireAuth` middleware’inden **önce** mount edilmelidir.
- `registerN8nRoutes` `/api` üzerindeki mevcut owner auth’tan **sonra** mount edilmelidir.
- Inbound processor parent’ın mevcut `processInboundWebhook` fonksiyonuna bağlanır. Olay önce `appendEvent` ile owner-scoped ve idempotent kaydedilir; tekrar gelen aynı olay işlenmez.
- Outbox worker, `deliverN8nEvent(store, event)` ile `type: "n8n-delivery"` olaylarını çalıştırabilir. Mevcut webhook rule branch’i için `deliverN8nWebhook(store, owner, lead, event)` export edilmiştir.

## Endpoint özeti

| Method | Endpoint | Davranış |
| --- | --- | --- |
| `GET` | `/api/n8n/settings` | `baseUrl`, `webhookUrl`, `configured`, `apiKeyConfigured` ve varsa son doğrulama `connected` durumu. Gizli anahtar dönmez. |
| `PUT` | `/api/n8n/settings` | HTTPS, credential/query/fragment içermeyen n8n URL’lerini owner-scoped `integration/n8n` kaydına yazar. `baseUrl` üzerindeki `/api/v1` normalize edilir. `webhookUrl` yalnızca aynı origin’deki üretim `/webhook/...` yoludur. |
| `POST` | `/api/n8n/test` | `GET {baseUrl}/api/v1/workflows?limit=1` ile salt-okuma bağlantı testi. `X-N8N-API-KEY` yalnızca burada ve diğer n8n Public API çağrılarında kullanılır. |
| `GET` | `/api/n8n/workflows?limit=25&cursor=...` | En fazla 50 kayıtlık güvenli workflow özetleri: `id`, `name`, `active`, `updatedAt`, güvenli `webhookPaths`. Node, credential veya ham veri dönmez. |
| `GET` | `/api/n8n/executions?limit=25&cursor=...` | En fazla 50 kayıtlık güvenli execution özetleri. Execution payload’ı dönmez. Yanıt `{data,nextCursor}` biçimindedir. |
| `POST` | `/api/n8n/token` | Owner açıkça istediğinde, `HMAC-SHA256(N8N_API_KEY, "xre:n8n:inbound:v1:" + ownerOpenId)` ile token üretir. Normal status yanıtlarında token yoktur. |
| `POST` | `/api/n8n/delivery` | Seçilen `leadId` ve olay tipi için pending, owner-scoped outbox olayı oluşturur. Varsayılan olay `lead.updated`’dir. Bu endpoint kendisi ağ isteği göndermez. |
| `POST` | `/api/n8n/rule` | `name`, `triggerStage`, opsiyonel `pipelineId`, `enabled` alır; mevcut CRM `RuleSchema` ile `action: "webhook"`, `config.provider: "n8n"` kuralı kaydeder. n8n workflow’u oluşturmaz veya aktive etmez. |
| `POST` | `/api/webhooks/n8n` | Auth middleware’den bağımsız inbound webhook. `Authorization: Bearer <owner-token>` ister, 1 MB JSON sınırı uygular ve yalnız `lead.created`, `lead.updated`, `stage.changed` olaylarını kabul eder. |

## Gizli değerler ve doğrulama

- `N8N_API_KEY` yalnızca güvenli sunucu ortamından okunur; veritabanına, frontend’e, loglara, generic webhook hedefine veya response body’sine yazılmaz.
- Yönetim Public API’si ile Webhook node kimlik doğrulaması ayrı protokollerdir. CRM inbound/outbound için API anahtarının kendisi yerine owner-scoped türetilmiş token kullanılır.
- Outbound n8n teslimatı `Authorization: Bearer <derived-token>`, `X-XRE-Event-ID`, `X-XRE-Timestamp` ve `X-XRE-Signature` başlıklarını kullanır. İmza `signedOutboundHeaders` ile türetilmiş token üzerinden oluşturulur.
- Saved webhook hedefi, kaydedilmiş n8n `baseUrl` ile aynı origin’de olmalı ve üretim `/webhook` yolunda bulunmalıdır. `/webhook-test`, query string, fragment ve URL credential’ları reddedilir.
- Upstream `401` yanıtı `N8N_API_KEY_INVALID`, `403` yanıtı `N8N_PERMISSION_DENIED` olarak sanitized döner. Upstream response body’si istemciye veya loga aktarılmaz.
- Outbound URL istekleri `fetchWithTimeout(..., 8000)` üzerinden gider. SSRF/private-network/DNS davranışının sahibi `server/security.ts`’dir.

## UI davranışı

`client/src/workspace/pages/N8n.tsx` canlı ve demo modunu ayırır:

- Demo modunda bağlantı testi, n8n kaynak listesi, token üretimi, rule kaydı ve gerçek delivery engellenir; sahte `connected` durumu gösterilmez.
- Token yalnızca kullanıcının **Tokenı göster** düğmesine basmasıyla alınır, bellek state’inde kalır ve localStorage’a yazılmaz. Kopyalama ayrı kullanıcı eylemidir.
- Workflow ve execution listeleri salt-okuma özetleri gösterir.
- Üretim webhook hedefi ve inbound URL açıkça ayrıdır. **Gerçek olay kuyruğa al** düğmesi yalnız canlı owner modunda, kullanıcı seçtiğinde gerçek outbox olayı üretir.

## Resmî n8n kaynakları

- [n8n Public API authentication](https://docs.n8n.io/connect/n8n-api/authentication/)
- [n8n Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)

n8n Public API anahtarı ile Webhook node’daki header/Bearer auth aynı şey değildir. API anahtarını workflow webhook URL’sine veya CRM inbound webhook’una yapıştırmayın. API anahtarı dönerse türetilmiş inbound/outbound token da değişir; n8n tarafındaki header credential aynı şekilde güncellenmelidir.

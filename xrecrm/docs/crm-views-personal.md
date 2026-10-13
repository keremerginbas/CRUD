# CRM kişisel görünümleri

Bu çalışma alanı, Bitrix benzeri ancak yalnızca mevcut CRM kayıtları üzerinde çalışan kişisel görünüm ayarlarını tanımlar.

## Ana sözleşme

`shared/crm-workspace.ts` tek kanonik sözleşmedir:

- `CrmWorkspaceFilters`: `query`, `owner`, `source`, `activity`, `pipeline` ve gelişmiş olarak `stage`, `city`, `createdFrom`, `createdTo`, `minValue`, `maxValue`, `contact`, `company`.
- Varsayılanlar: `query: ""`, `owner/source/activity: "all"`, `pipeline: "sales"`, tarih/tutar/şehir boş, `contact/company: "any"`.
- `CrmWorkspaceAppearance`: `cardProfile` (`compact`, `standard`, `detailed`) ve `listColumns`.
- Liste sütunları yalnızca `stage`, `value`, `next`, `owner`, `source` seçenekleriyle değişir; `name` her zaman bulunur ve `communication` her zaman korunur.
- `SavedCrmView`: `id`, `name`, `filters`, `createdAt`.
- `CrmWorkspacePreferences`: en fazla 20 kişisel görünüm ve görünüm düzeni.

`matchesCrmWorkspaceFilters` ve `filterCrmWorkspaceRecords` saf yardımcılar olarak aynı koşulları şehir, aşama, oluşturulma tarih aralığı, tutar aralığı, kişi/şirket bağlantısı ve etkinlik durumu için uygular. Yardımcılar CRM sağlayıcısı veya veritabanı sorgusu yapmaz; çağıran katman önce yetkili kaynak dizisini vermelidir. Kişi/şirket bağlantısı yalnızca gerçek `contactId`/`companyId` (veya açık `linkedContact`/`linkedCompany` nesnesi) ile belirlenir; eski lead kaydındaki serbest `company` portföy metni ilişki sayılmaz. Eski isimlerle gelen `createdAfter/Before`, `amountMin/Max` ve `linkedContact/Company` alanları yalnızca parser girişinde canonical isimlere dönüştürülür.

## Sunucu API'si

`registerCrmWorkspaceRoutes(app, rawStore)` yalnızca şu iki endpoint'i kaydeder:

- `GET /api/crm-workspace/preferences`
- `PUT /api/crm-workspace/preferences`

Her iki istek de doğrulanmış oturum ve CRM **read** yetkisi ister. Kullanıcı kimliği URL'den veya body'den alınmaz; `req.auth`/`currentPermissionContext()` içindeki `auth.user.openId` ile `rawStore` üzerinde kullanıcıya özel kayıt anahtarı ve `auth.ownerOpenId` kapsamı sunucu tarafında türetilir. Başka kullanıcının kayıtlarını listeleyen, silen veya CRUD yapan endpoint yoktur. Roller ya da hassas auth metadata'sı yanıta yazılmaz. Şema unknown key'leri reddeder, tarih ve tutar değerlerini güvenli sınırlar içinde doğrular, listeyi 20 görünümle sınırlar.

## UI montaj sözleşmesi

Ana CRM sayfası komponenti kontrollü biçimde bağlar:

```tsx
<CRMPersonalization
  filters={filters}
  appearance={{ cardProfile, listColumns }}
  onApply={(nextFilters) => setFilters(nextFilters)}
  onAppearanceChange={(nextAppearance) => setAppearance(nextAppearance)}
/>
```

`value={{ filters, appearance }}` + `onApply` birleşik state biçimi de desteklenir. Gelişmiş modal, filtreleri kullanıcı “Filtreleri uygula” diyene kadar draft'ta tutar; görünüm seçimi yalnızca seçilen kişisel görünümün filtrelerini uygular. Kişisel görünüm silme geri alınabilir ve CRM kaydını silmez. Demo modunda API çağrısı yapılmaz; `localStorage` anahtarı demo ve kullanıcı kimliğiyle ayrılır. Yetki veya ağ hataları genel, kullanıcıya güvenli hata mesajlarıyla gösterilir.

# XRE n8n Raporları — 13.10.2026 düzeltmeleri

Bu klasörde beş n8n workflow'unun düzeltilmiş halleri ve yapılan denetimin sonuçları var.

> **Bu repo herkese açık (public).** Bitrix admin webhook'u, Telegram bot token'ı, Assistant API anahtarı ve
> Google Sheet kimlikleri buradaki dosyalarda `<BITRIX_WEBHOOK_TOKEN>`, `<TELEGRAM_BOT_TOKEN>`,
> `<ASSISTANT_API_KEY>`, `<GOOGLE_SHEET_ID_...>` olarak maskelendi. İçe aktarmaya hazır (gizli bilgileri dolu)
> dosyalar ayrıca doğrudan teslim edildi. Bu klasördeki dosyaları kullanacaksanız önce yer tutucuları doldurun.

| Dosya | Ne |
|---|---|
| `workflows/1_Gunluk_Arama_Randevu_Etkinlik_Raporu_v2.json` | Kerem grubuna 20:00'de giden günlük rapor — **yeni sürüm** |
| `workflows/2_Etkinlik_Takip_Telegram_Raporu_v3_duzeltildi.json` | Etkinlik takip + gün sonu raporu |
| `workflows/3_Bitrix_Ekip_Raporu_v2.1_duzeltildi.json` | Ekip performans raporu |
| `workflows/4_Call_Center_Performans_Denetim_V3.1_duzeltildi.json` | Call Center günlük/haftalık Excel raporu |
| `workflows/5_XRE_Bitrix_Assistant_v8_duzeltildi.json` | Bitrix asistan API'si (MCP) |
| `kod/gunluk_rapor.js` | 1 numaralı raporun ana Code düğümü (okumak/incelemek için) |

---

## 1. Günlük Arama + Randevu + Satış + Etkinlik Raporu (v2)

Eski "Günlük Arama Raporu"nun üzerine kuruldu; arama bölümü aynı kaldı (aynı gün için aynı arama / görüşme /
süre sayıları doğrulandı). Her personel, her departman ve GENEL için:

| Satır | Ne sayılır |
|---|---|
| 📞 Arama · görüşme (20sn+) · cevapsız · süre | Bitrix telefoni kaydı (`voximplant.statistic.get`), bugün 00:00 → rapor anı |
| 📅 Randevu | Bugün randevu aşamasına **giren** lead/anlaşma sayısı |
| ✅ Katıldı / ❌ Katılmadı | Bugün `RANDEVUYA KATILIM OLDU` / `RANDEVUYA KATILIM OLMADI` aşamasına giren lead |
| 💰 Satış | Bugün satış aşamasına giren lead/anlaşma |
| 📋 Tamamlanan etkinlik | Bugün tamamlanan görev, toplantı, e-posta vb. (otomatik arama kaydı, web formu, açık hat oturumu hariç) |
| Bugün vadeli (tamamlanan) | Son tarihi bugün olan etkinlikler ve bunların tamamlanmışları |
| ⏰ Geciken etkinlik | Tamamlanmamış ve son tarihi geçmiş **tüm** etkinlikler — geçmiş tarih sınırı yok; lead, anlaşma, kişi, şirket dahil. Parantezde kaç farklı lead/anlaşmaya dağıldığı |
| Açık toplam | Vadesi gelmemişler dahil bütün açık etkinlikler |

GENEL bölümünde ayrıca **en çok geciken etkinliği olan 5 kişi** listelenir.

### Aşama eşleşmesi

Lead aşamaları (ID ile, kodun başındaki `LEAD_ASAMA` ayarı):

| Grup | Bitrix aşaması |
|---|---|
| Randevu | `UC_WK3LVR` RANDEVU OLUŞTURANLAR · `UC_Z3VV8S` OFİS RANDEVUSU · `UC_ML92HM` YAPAY ZEKA RANDEVU OLUŞTURANLAR |
| Katıldı | `UC_UB8IU8` RANDEVUYA KATILIM OLDU |
| Katılmadı | `UC_OHQ6DS` RANDEVUYA KATILIM OLMADI |
| Satış | `UC_I8G5YP` SATIŞ |

Anlaşma (deal) pipeline'larında her departmanın kendi aşamaları olduğu için adına göre sınıflanır:
adında **RANDEVU** geçen aşama = randevu ("KATILIM" ve "DÜZENLENECEK" hariç); **başarılı kapanış (WON)** ve adı
`SATIŞ`, `ANLAŞMA YAPILAN`, `ANLAŞMA SAĞLANDI`, `POLİÇE ONAYLANDI` olan aşama = satış. Kaybedildi (F) aşamaları
hiç sayılmaz. Böylece Recruiting, Franchise, Arsa, Barter, Partners, Auto pipeline'larındaki randevu/satışlar da
ilgili kişiye yazılır.

Kurallar:
- Rapor **yalnızca güncel personel listesini** (kodun başındaki `personeller`, 18 kişi) kapsar. Listede olmayan
  kullanıcıların aramaları, randevuları ve etkinlikleri sayılmaz; TANIMSIZ grubu yoktur. Personel değişince
  sadece bu listeyi güncelleyin (anahtarlarda boşluk olmamasına dikkat: `"29484"`, `"29484 "` değil).
- Aynı kayıt gün içinde iki randevu aşamasından geçse de **1** randevu sayılır.
- Kayıt, **şu anki sorumlusuna** (`ASSIGNED_BY_ID`) yazılır. Bitrix aşama geçmişi taşıyan kişiyi tutmuyor;
  son 30 günün randevu/katılım/satış hareketlerinin %87'sinde son taşıyan ile sorumlu aynı kişi.
- Bir veri kaynağı hata verirse rapor yine gönderilir; o bölüm `?` ile gösterilir ve sonda uyarı yazılır.
- Pasif ve o gün hiç verisi olmayan personel listelenmez, sonda adı yazılır.
- Telegram'a HTML biçiminde, 3.500 karakterlik parçalar halinde gönderilir (tek mesaj sınırı 4.096).

### "Cevapsız" tanımı değişti

Eski rapor yalnızca `603` (reddedildi) kodunu cevapsız sayıyordu. Bitrix'te giden aramada karşı taraf
açmadığında `603-S` (iptal), `503`, `500`, `486` kodları da gelir; `304` ise sadece kaçırılan **gelen** aramadır.
Yeni raporda **cevapsız = sonucu 200 olmayan her arama**. Bu yüzden cevapsız sayıları eski rapora göre belirgin
şekilde artar; bu artış gerçek durumu gösterir.

---

## 2. Denetim — bulunan sorunlar ve kararlar

| # | Workflow | Sorun | Etkisi | Karar |
|---|---|---|---|---|
| 1 | Ekip Raporu v2.1 | `rest/78/...` webhook'unda yalnızca `crm` + `telephony` izni var; ilk sorgu `user.get` → `insufficient_scope` | Kişi doğrulanamıyor, **tüm kişi sayaçları "Bilinmiyor"** | Tüm izinleri olan `rest/1/...` webhook'una geçildi. Canlı testte 346/346 sorgu başarılı |
| 2 | Ekip Raporu v2.1 | Telegram bot token'ının son karakteri eksik (34 karakter; geçerli token 35) | Rapor Telegram'a **hiç gitmiyor** | Token tamamlandı |
| 3 | Call Center V3.1 | Aynı eksik token 4 Telegram düğümünde; düğümler hata yutuyor (`continueRegularOutput`) | Günlük/haftalık Excel ve özet Telegram'a **sessizce gitmiyor** (e-posta gidiyor) | Token tamamlandı |
| 4 | Etkinlik Takip v3 | Geciken sorgusu **son 30 gün** ile sınırlı | Eski gecikmeler görünmüyor (bir kişide 30 görünüp gerçekte ~590) | Tarih sınırı kaldırıldı — tüm geçmiş |
| 5 | Etkinlik Takip v3 | Giden aramada cevapsız `304` ile sayılıyor (304 sadece gelen arama kodu) | Herkeste "cevapsız 0", her şey "diğer" | 200 olmayan giden arama = cevapsız |
| 6 | Etkinlik Takip v3, Call Center, Günlük rapor | Listede olmayan (eski/pasif) kullanıcılar "liste dışı" / "TANIMSIZ" / "Personel listesinde yok" satırlarıyla rapora giriyor | Tüm geçmiş gecikmelerle 20+ eski kullanıcı rapora giriyordu | **Yalnızca güncel 18 çalışan** raporlanır; geciken sorgusu doğrudan bu kişilerle sınırlandı, liste dışı satırlar (Call Center Excel'i dahil) çıkarıldı |
| 7 | Assistant v8 | Günlük rapor en fazla 20 sayfa × 50 = **1.000** etkinlik okuyor; günde 1.700–2.000 etkinlik oluşuyor | Günün yarısı (öğleden sonrası) raporda yok | 49 sayfaya (2.450) çıkarıldı, `truncated` uyarısı eklendi, isim çözme batch'i 50 komutla sınırlandı. Test: 2.004/2.004 |
| 8 | Assistant v8 | "Activity Audit Bindings" düğümünde webhook adresi harfleri karışık (`9duevovotuo09s8a`) | `get_activity_audit_bindings` çağrısı hata veriyor | Adres düzeltildi |
| 9 | Hepsi | Personel listeleri birbirinden farklı ve eski (pasif kişiler var, yeni kişiler yok) | Yeni kişiler "Personel listesinde yok" / "TANIMSIZ" görünüyor | 13.10.2026 listesine (18 kişi) eşitlendi. Enes Can Yıldırım (Bitrix'te XRE Auto) eklendi |
| 10 | Ekip Raporu v2.1 | Randevu aşamalarında `YAPAY ZEKA RANDEVU OLUŞTURANLAR` yok | YZ randevuları sayılmıyor | Eklendi |
| 11 | Etkinlik Takip v3 | Webhook kolu `rest/78` kullanıyor | Şu an çalışıyor ama o kullanıcı kapanırsa durur | `rest/1`'e geçildi |

### Düzeltilmeyenler / bilinmesi gerekenler

- **Etkinlik Takip — "Aradı ama kapatmadı" ve "Yeni lead aranmadı":** Bitrix aramaların büyük çoğunluğunu
  lead'e değil **kişiye (CONTACT)** bağlıyor; bir günde ~1.200 aramadan ~65'i lead'e bağlı. Bu iki metrik lead
  eşleşmesiyle çalıştığı için olduğundan düşük/yüksek çıkar. Doğru sonuç için telefon numarasıyla eşleştirme
  gerekir; ayrı bir iş olarak önerilir.
- **Tamamlanan etkinlik zamanı:** Bitrix REST tamamlanma anını vermez. "Bugün güncellenmiş ve tamamlanmış"
  etkinlik sayılır. Etkinlik Takip'teki Google Sheet günlüğü bu yüzden tutuluyor.
- **Telegram token'ı canlı test edilmedi:** Düzeltme token uzunluğuna dayanıyor (Telegram bot token'ının gizli
  kısmı her zaman 35 karakter); çalışan Etkinlik Takip workflow'undaki token ile aynı yapıldı.
- **Assistant v8:** API anahtarı kodda sabit yazılı; Action Router'da hiç ulaşılmayan (ölü) kurallar var.
  Davranışı etkilemediği için dokunulmadı.
- **Ekip Raporu:** randevuya katılım metriği yok; bu bilgi 1 numaralı günlük raporda var.

---

## 3. Kurulum

1. n8n → **Import from file** ile ilgili JSON'u içe aktarın (gizli bilgileri dolu teslim dosyası).
2. Telegram / Gmail / Google Sheets / Postgres kimlik bilgileri (credentials) eşleşmediyse düğümlerde yeniden seçin.
3. Önce **Execute workflow** ile bir kez elle çalıştırıp çıktıyı kontrol edin.
4. Yeni workflow'u aktif edin, **eski sürümü pasif yapın** (iki rapor birden gitmesin).

1 numaralı rapor her gün 20:00'de çalışır, yaklaşık 15 Bitrix isteği ile 6–8 saniyede tamamlanır.

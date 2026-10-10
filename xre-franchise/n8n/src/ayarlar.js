// ================================================================
//  XRE FRANCHISE — KURUCU 100 — AYARLAR
//  Bu node 4 workflow'da da var (00 Kurulum, 01 Arama Kuyruğu, 02 Outbound, 05 Rapor). Değerleri HEPSİNDE aynı tutun.
// ================================================================
const AYARLAR = {
  PROJE_ADI: 'XRE Franchise — Kurucu 100',

  // Bitrix24 gelen webhook adresi — sonu "/" ile bitmeli.
  BITRIX_WEBHOOK: 'https://xre.bitrix24.com.tr/rest/BITRIX_USER_ID/BITRIX_WEBHOOK_KODU/',

  // Vapi (API anahtarı "Vapi API" adlı Header Auth credential'ında durur)
  VAPI_API: 'https://api.vapi.ai',
  VAPI_OUTBOUND_ASISTAN: 'XRE FRANCHISE - OUTBOUND',
  // Bu kampanyaya ayrılan hatlar (Vapi Phone Numbers'daki numaralarla birebir aynı). 140K'lık hacim için birden fazla hat önerilir.
  ARAYAN_NUMARALAR: ['+90XXXXXXXXXX'],

  // 02 Outbound webhook adresi. Boş bırakılırsa n8n adresinizden otomatik bulunur.
  OLAY_WEBHOOK_URL: '',

  // Bitrix lead statüleri — bu 9 statüyü Bitrix'te oluşturup kodlarını (UC_xxxxxxxx) buraya yazın.
  STATU: {
    ARANACAK: 'UC_XXXXXXXX', // Aranacak → kuyruk burası
    AI_GORUSTU: 'UC_XXXXXXXX', // AI Görüştü (ilgilenmedi/ulaşılamadı/dnc sonrası da burada kalır)
    ILGILENIYOR: 'UC_XXXXXXXX', // İlgileniyor (randevu veya sıcak/çok sıcak ilgi)
    VIDEO_GONDERILDI: 'UC_XXXXXXXX', // Video Gönderildi
    ASISTAN_ARAYACAK: 'UC_XXXXXXXX', // Asistan Arayacak (insan franchise asistanına devir)
    SUNUM_YAPILDI: 'UC_XXXXXXXX', // Sunum Yapıldı (insan elle taşır)
    ERDAL_ONAYI: 'UC_XXXXXXXX', // Erdal Bey Onayı (insan elle taşır)
    SOZLESME: 'UC_XXXXXXXX', // Sözleşme (insan elle taşır)
    FRANCHISE_ACILIS: 'UC_XXXXXXXX', // Franchise Açılış (insan elle taşır)
  },

  // 00-Kurulum workflow'unun oluşturduğu lead alanları
  ALAN: {
    DENEME: 'UF_CRM_XFR_AI_TRY', // kaçıncı arama
    SONRAKI: 'UF_CRM_XFR_AI_NEXT', // bir sonraki arama zamanı
    SONUC: 'UF_CRM_XFR_AI_RES', // son sonuç (ARANIYOR, ULASILAMADI, GERI_ARANACAK, DNC, İLGİLENMEDİ, İLGİLENİYOR...)
    CAGRI: 'UF_CRM_XFR_AI_CALL', // son Vapi call ID
  },

  // ---- Outbound kapasite (140K lead → ölçeklendirin) ----
  TUR_BASINA_MAX_ARAMA: 3, // her turda en fazla kaç arama başlasın
  HAT_BASINA_ESZAMANLI: 1, // bir numaradan aynı anda kaç arama

  // Video gönderilen adayı arayıp sunum randevusu netleştirecek insan franchise asistanı (Bitrix kullanıcı ID'si).
  FRANCHISE_ASISTAN_SORUMLU_ID: '',

  // ---- Arama kuralları ----
  MAX_DENEME: 3, // ulaşılamayan bir aday en fazla kaç kez aransın
  ULASILAMADI_TEKRAR_DK: [240, 480, 1440], // 1. açmadı → 4 saat, 2. → 8 saat, 3. → ertesi gün
  HATA_TEKRAR_DK: 15, // Vapi araması başlatılamazsa
  KILIT_DK: 30, // arama sürerken aday tekrar seçilmesin

  // Saatler İstanbul saatidir. GUNLER: 1=Pazartesi ... 7=Pazar
  ARAMA_SAATLERI: { GUNLER: [1, 2, 3, 4, 5, 6], BASLA: '09:00', BITIS: '18:00' },

  // ---- WhatsApp (Meta WhatsApp Cloud API, "WhatsApp API" Header Auth credential: Bearer token) ----
  // "evet video gönderin" diyen HER adaya gönderilir (toplu değil, tek tek, ilgi gösterene). Şablon Meta'da onaylı olmalı.
  WHATSAPP: {
    AKTIF: false,
    API_URL: 'https://graph.facebook.com/v21.0',
    TELEFON_NUMARASI_ID: 'WHATSAPP_PHONE_NUMBER_ID',
    DIL: 'tr',
    SABLON: { ad: 'xre_franchise_tanitim', parametreler: ['isim'] }, // {{1}} = isim
  },

  // ---- Telegram (franchise ekibi rapor grubu; "XRE Rapor Botu" credential'ı) ----
  TELEGRAM: {
    AKTIF: true,
    CHAT_ID: '-100FRANCHISE_RAPOR_GRUBU',
  },
};

if (!AYARLAR.OLAY_WEBHOOK_URL) {
  try {
    AYARLAR.OLAY_WEBHOOK_URL = String($execution.resumeUrl).replace(/\/webhook-waiting\/.*$/, '/webhook/xre-franchise-outbound');
  } catch (e) {}
}

return [{ json: AYARLAR }];

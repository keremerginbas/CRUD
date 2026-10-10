// ================================================================
//  XRE ANKAPORT HİSSE — AYARLAR
//  Bu node 3 workflow'da da var (01 Form, 02 Outbound, 03 Inbound). Değerleri HEPSİNDE aynı tutun.
// ================================================================
const AYARLAR = {
  PROJE_ADI: 'XRE Ankaport Hisse',
  PROJE_TELEFON: '444 98 90',
  PROJE_URL: 'https://ankaportsaray.com',

  // Bitrix24 gelen webhook adresi — sonu "/" ile bitmeli.
  BITRIX_WEBHOOK: 'https://xre.bitrix24.com.tr/rest/BITRIX_USER_ID/BITRIX_WEBHOOK_KODU/',

  // Vapi (API anahtarı "Vapi API" adlı Header Auth credential'ında durur)
  VAPI_API: 'https://api.vapi.ai',
  VAPI_OUTBOUND_ASISTAN: 'ANKAPORT HİSSE - OUTBOUND',
  VAPI_INBOUND_ASISTAN: 'ANKAPORT HİSSE - INBOUND',
  // Ankaport Hisse için ayrılan, hem outbound aramayı yapan hem inbound aramayı karşılayan numara
  ARAYAN_NUMARA: '+90XXXXXXXXXX',

  // n8n'in kendi adresi (fırsat afişini e-postada göstermek için). Boş bırakılırsa otomatik bulunur.
  N8N_TABAN_URL: '',

  // Bitrix lead statüleri
  STATU: {
    REKLAM: 'UC_0RQEPM', // ankaport reklam → form dolduğunda lead buraya düşer, AI burada arar
    RANDEVU: 'UC_WK3LVR', // RANDEVU OLUŞTURANLAR
  },

  // Arama saatleri. Bu pencere dışında form dolarsa arama pencere başlangıcına ertelenir.
  ARAMA_SAATLERI: { GUNLER: [1, 2, 3, 4, 5, 6], BASLA: '10:00', BITIS: '19:00' },
  RANDEVU_SAATLERI: { GUNLER: [1, 2, 3, 4, 5, 6, 7], BASLA: '10:00', BITIS: '18:00' },
  RANDEVU_MAX_GUN: 30,

  // Yeni inbound arayan (Bitrix'te hiç kaydı olmayan) lead'in sorumlusu. Boşsa atanmaz, sonra elle atanır.
  VARSAYILAN_SORUMLU_ID: '',
  INBOUND_KAYNAK_ID: 'CALL',

  // ---- SMS (Erccell CORPORATESMS XML servisi) ----
  SMS: {
    AKTIF: true,
    API_URL: 'https://gateway.erccell.com.tr/corporatesms/sendsms/',
    KULLANICI: 'SMS_KULLANICI_ADI',
    SIFRE: 'SMS_SIFRE',
    BASLIK: 'XRE',
    // NUMBERS alanı: Erccell yalnızca 905XXXXXXXXX biçimini kabul ediyor (EFAS N-TEPE'de doğrulandı)
    METIN: 'Ankara AnkaPort Saray başvurunuz alınmıştır. Danışmanımız en kısa sürede sizinle iletişime geçecektir. XRE\'li günler dilerim.',
  },

  // ---- E-posta ("Ankaport SMTP" credential'ı; lead'in EMAIL alanındaki adrese) ----
  EPOSTA: {
    AKTIF: true,
    GONDEREN: 'XRE Project <xre.project@xre.com.tr>',
    // Fırsat görselinin adresi. Boşsa 01 workflow'u görseli kendisi yayınlar: …/webhook/ankaport-hisse-afis
    GORSEL_URL: '',
    KONU: 'AnkaPort Saray — Cadde Dükkanlarda Yeni Fırsatlar',
    PARAGRAFLAR: [
      'Merhaba,',
      'AnkaPort Saray başvurunuz alınmıştır. Danışmanımız en kısa sürede sizinle iletişime geçecektir.',
      'Bu arada cadde dükkanlarımızdaki güncel fırsatları da sizinle paylaşmak istedik (ekteki görsel) — 16 ay taksit avantajıyla.',
    ],
  },

  // ---- Telegram (rapor grubu; "XRE Rapor Botu" credential'ı, bot gruba eklenmeli) ----
  TELEGRAM: {
    AKTIF: true,
    CHAT_ID: '-4907631457',
  },
};

if (!AYARLAR.N8N_TABAN_URL) {
  try {
    AYARLAR.N8N_TABAN_URL = String($execution.resumeUrl).replace(/\/webhook-waiting\/.*$/, '');
  } catch (e) {}
}

return [{ json: AYARLAR }];

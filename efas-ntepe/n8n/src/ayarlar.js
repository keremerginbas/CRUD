// ================================================================
//  EFAS N-TEPE — AYARLAR
//  Bu node 6 workflow'da da var. Değerleri HEPSİNDE aynı tutun.
// ================================================================
const AYARLAR = {
  PROJE_ADI: 'EFAS N-TEPE',
  PROJE_TELEFON: '444 24 53',

  // Bitrix24 gelen webhook adresi — sonu "/" ile bitmeli.
  // Bitrix > Geliştirici kaynakları > Diğer > Gelen webhook (yetki: CRM)
  BITRIX_WEBHOOK: 'https://BITRIX_ALANINIZ/rest/KULLANICI_ID/WEBHOOK_KODU/',

  // Vapi (API anahtarı "Vapi API" adlı Header Auth credential'ında durur)
  VAPI_API: 'https://api.vapi.ai',
  // Asistanın Vapi'deki ADI ya da ID'si. Ad yazılırsa sistem ID'yi kendisi bulur.
  VAPI_OUTBOUND_ASISTAN: 'EFAS N-TEPE - OUTBOUND',
  VAPI_INBOUND_ASISTAN: 'EFAS N-TEPE - INBOUND', // sadece 00-Kurulum kontrolü için

  // Aramaların yapılacağı numaralar (Vapi'deki Phone Numbers ile birebir aynı)
  ARAYAN_NUMARALAR: ['+905337436876', '+905337437088', '+908503465993'],

  // 04-Olay ve Mesaj Merkezi webhook adresi. Boş bırakılırsa n8n adresinizden otomatik bulunur.
  OLAY_WEBHOOK_URL: '',

  // Bitrix lead statüleri
  STATU: {
    YAPAY_ZEKA: 'UC_3W9EXO', // EFAS N-TEPE YAPAY ZEKA  → arama kuyruğu
    OLUMSUZ: 'UC_PTDA4Y', // EFAS N-TEPE OLUMSUZ
    RANDEVU: 'UC_ML92HM', // YAPAY ZEKA RANDEVU OLUŞTURANLAR
    INBOUND_YENI: 'UC_PQDHUK', // EFAS İÇİN GELEN → inbound'da randevu almayan YENİ arayanlar
    BILGI: 'UC_PQDHUK', // "bilgi istiyorum" diyenler → satış temsilcisi arasın (EFAS İÇİN GELEN)
  },

  // 00-Kurulum workflow'unun oluşturduğu lead alanları
  ALAN: {
    DENEME: 'UF_CRM_EFAS_AI_TRY', // kaçıncı arama
    SONRAKI: 'UF_CRM_EFAS_AI_NEXT', // bir sonraki arama zamanı
    SONUC: 'UF_CRM_EFAS_AI_RES', // son sonuç (ARANIYOR, ULASILAMADI, TEKRAR_ARA, RANDEVU, OLUMSUZ...)
    CAGRI: 'UF_CRM_EFAS_AI_CALL', // son Vapi call ID
    RANDEVU: 'UF_CRM_EFAS_AI_APPT', // randevu tarihi
  },

  // ---- Outbound kapasite ----
  // Günlük kapasite ≈ (60 / tur aralığı dk) × TUR_BASINA_MAX_ARAMA × çalışma saati
  //   3 dk, 3 arama, 9 saat → ~540/gün  |  3 dk, 6 arama (HAT_BASINA_ESZAMANLI: 2) → ~1080/gün
  TUR_BASINA_MAX_ARAMA: 3, // her turda en fazla kaç arama başlasın
  HAT_BASINA_ESZAMANLI: 1, // bir numaradan aynı anda kaç arama (SIP hattı izin veriyorsa 2+)

  // ---- Outbound arama kuralları ----
  MAX_DENEME: 3, // ulaşılamayan / kararsız lead en fazla kaç kez aransın
  TEKRAR_ARA_EK_HAK: 2, // müşteri "sonra arayın" dediyse tanınacak ek arama hakkı
  ULASILAMADI_TEKRAR_DK: 120, // açmayan / meşgul → kaç dakika sonra tekrar
  KARARSIZ_TEKRAR_DK: 1440, // görüştü ama karar vermedi → kaç dakika sonra tekrar
  HATA_TEKRAR_DK: 15, // Vapi araması başlatılamazsa
  KILIT_DK: 30, // arama sürerken lead'in tekrar seçilmemesi için kilit
  OLUMSUZA_TASIMA_TUR_LIMITI: 20, // bir turda en fazla kaç "hakkı biten" lead kapatılsın

  // Saatler İstanbul saatidir. GUNLER: 1=Pazartesi ... 7=Pazar
  ARAMA_SAATLERI: { GUNLER: [1, 2, 3, 4, 5, 6], BASLA: '10:00', BITIS: '19:00' },
  RANDEVU_SAATLERI: { GUNLER: [1, 2, 3, 4, 5, 6, 7], BASLA: '10:00', BITIS: '18:00' },
  RANDEVU_MAX_GUN: 30, // en fazla kaç gün sonrasına randevu verilsin

  // ---- Sorumlu atama ----
  // Satış temsilcilerinin Bitrix kullanıcı ID'leri (ör. [12, 45, 78]).
  // Randevu, OLUMSUZ ve "bilgi istiyor" sonuçlarında lead bu kişilere SIRAYLA atanır.
  // Boşsa lead'in mevcut sorumlusu korunur (yeni inbound lead'lerde VARSAYILAN_SORUMLU_ID).
  SATIS_SORUMLU_IDLERI: [],
  VARSAYILAN_SORUMLU_ID: '',
  // Yeni lead kaynağı (Bitrix > CRM > Ayarlar > Kaynaklar). 'CALL' = Çağrı
  INBOUND_KAYNAK_ID: 'CALL',

  // ---- SMS (Erccell CORPORATESMS XML servisi) ----
  SMS: {
    AKTIF: false,
    API_URL: 'https://gateway.erccell.com.tr/corporatesms/sendsms/', // Erccell
    KULLANICI: 'SMS_KULLANICI_ADI',
    SIFRE: 'SMS_SIFRE',
    BASLIK: 'XRE', // onaylı gönderici başlığı
    METIN: {
      randevu:
        'Sayın {ad}, Yeni Yaşamkent EFAS N-Tepe ziyaret randevunuz {tarih} olarak oluşturuldu. Danışmanımız konum için sizi arayacak. Bilgi: {telefon} XRE Project',
      randevu_talep:
        'Sayın {ad}, Yeni Yaşamkent EFAS N-Tepe randevu talebiniz alındı. Satış temsilcimiz gün ve saati belirlemek için sizi arayacak. Bilgi: {telefon} XRE Project',
      // ilk aramada ulaşılamayan müşteriye
      tanitim: "Efas Entepe projesi için sizi aradık, ulaşamadık. Fiyatlar 3.150.000 TL'den başlıyor. Detaylı bilgi: https://form.xre.com.tr/efas/",
      bilgi: '',
    },
  },

  // ---- WhatsApp (Meta WhatsApp Cloud API, "WhatsApp API" Header Auth credential: Bearer token) ----
  // Şablonlar Meta Business Manager'da onaylı olmalı. {{1}} = ad, {{2}} = randevu tarihi
  WHATSAPP: {
    AKTIF: false,
    API_URL: 'https://graph.facebook.com/v21.0',
    TELEFON_NUMARASI_ID: 'WHATSAPP_PHONE_NUMBER_ID',
    DIL: 'tr',
    SABLON: {
      randevu: { ad: 'efas_randevu_teyit', parametreler: ['ad', 'tarih'] },
      randevu_talep: { ad: 'efas_randevu_talep', parametreler: ['ad'] },
      tanitim: { ad: 'efas_tanitim', parametreler: ['ad'] },
      bilgi: { ad: 'efas_bilgi', parametreler: ['ad'] },
    },
  },

  // ---- E-posta ("EFAS SMTP" credential'ı; lead'in EMAIL alanındaki adrese) ----
  // Ticari e-posta için İYS onayı gerekir. GONDEREN, SMTP hesabının adresi olmalı.
  EPOSTA: {
    AKTIF: false,
    GONDEREN: 'XRE Project <info@xre.com.tr>',
    // Afiş görselinin adresi. Boşsa 04 workflow'u görseli kendisi yayınlar: …/webhook/efas-ntepe-afis
    GORSEL_URL: '',
    FORM_URL: 'https://form.xre.com.tr/efas/',
    PROJE_URL: 'https://xreproject.com/projeDetay/efas-n-tepe',
    SABLON: {
      tanitim: {
        konu: 'Yeni Yaşamkent’te Özel Bir Yaşam Fırsatı XRE ile Sizi Bekliyor',
        paragraflar: [
          'Merhaba,',
          'Yeni Yaşamkent’in en özel arsasında, ayrıcalıklı bir yaşam fırsatı XRE ile sizi bekliyor.',
          'Modern mimarisi, güçlü lokasyonu ve avantajlı ödeme seçenekleriyle öne çıkan projede 3.150.000 TL’den başlayan fiyatlarla yeni bir yaşama adım atabilirsiniz. Kişiye özel ödeme planı ve kredi kartına taksit avantajıyla projeyi hem yaşam hem de yatırım için değerlendirebilirsiniz.',
          'Detaylı bilgi almak ve güncel ödeme seçeneklerini öğrenmek için başvuru formunu doldurabilirsiniz:',
        ],
      },
    },
  },

  // ---- Telegram (rapor grubu; "EFAS Telegram Bot" credential'ı, bot gruba eklenmeli) ----
  TELEGRAM: {
    AKTIF: false,
    CHAT_ID: '-100GRUP_ID', // grup ID'si (eksi ile başlar)
    ANLIK_RANDEVU_BILDIRIMI: true, // her randevuda gruba anlık mesaj
  },
};

// OLAY_WEBHOOK_URL boşsa bu n8n'in kendi adresinden türet (…/webhook-waiting/ID → …/webhook/efas-ntepe-olay)
if (!AYARLAR.OLAY_WEBHOOK_URL) {
  try {
    AYARLAR.OLAY_WEBHOOK_URL = String($execution.resumeUrl).replace(/\/webhook-waiting\/.*$/, '/webhook/efas-ntepe-olay');
  } catch (e) {}
}

return [{ json: AYARLAR }];

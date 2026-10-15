// Arayüzden düzenlenebilen entegrasyon ayarları. Sunucu bu listede olmayan
// hiçbir ortam değişkenini değiştirmez.
export interface SettingField {
  key: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  placeholder?: string;
  help?: string;
}
export interface SettingGroup {
  id: string;
  title: string;
  description: string;
  test?: string;
  fields: SettingField[];
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "general",
    title: "Genel",
    description: "Dış servislerin CRM'e ulaşacağı adres ve iç ağ izinleri.",
    fields: [
      { key: "PUBLIC_ORIGIN", label: "CRM genel adresi", placeholder: "https://crm.xre.com.tr", help: "Webhook, QR ve sosyal giriş dönüş adresleri bu adresle oluşturulur." },
      { key: "OUTBOUND_ALLOW_PRIVATE_HOSTS", label: "İzinli iç ağ adresleri", placeholder: "10.0.0.5,n8n.local", help: "Kendi sunucunuzdaki n8n/santral için virgülle ayırın." },
    ],
  },
  {
    id: "pbx",
    title: "Santral (Asterisk / FreePBX / Netgsm)",
    description: "Tıkla-ara ve gelen aramada müşteri kartı. Asterisk AMI veya URL tabanlı santral.",
    test: "pbx",
    fields: [
      { key: "PBX_DRIVER", label: "Sürücü", placeholder: "asterisk veya http", help: "asterisk: AMI ile arama başlatır ve gelen aramaları dinler. http: santralin tıkla-ara URL'sini çağırır." },
      { key: "AMI_HOST", label: "AMI sunucusu", placeholder: "10.0.0.10" },
      { key: "AMI_PORT", label: "AMI portu", placeholder: "5038" },
      { key: "AMI_USERNAME", label: "AMI kullanıcı adı", placeholder: "xrecrm" },
      { key: "AMI_SECRET", label: "AMI şifresi", secret: true },
      { key: "AMI_ORIGINATE_CONTEXT", label: "Arama context'i", placeholder: "from-internal" },
      { key: "AMI_CHANNEL_TEMPLATE", label: "Dahili kanal şablonu", placeholder: "PJSIP/{ext}", help: "{ext} çalışanın dahili numarasıyla değiştirilir." },
      { key: "PBX_CLICK_TO_CALL_URL", label: "Tıkla-ara URL şablonu (http)", placeholder: "https://santral/api/call?ext={ext}&number={number}", help: "{ext}, {number} ve {line} yer tutucuları kullanılabilir." },
      { key: "PBX_CLICK_TO_CALL_TOKEN", label: "Tıkla-ara anahtarı (http)", secret: true, help: "Authorization: Bearer başlığı olarak gönderilir." },
      { key: "PBX_GATEWAY_URL", label: "PBX ağ geçidi URL", placeholder: "https://pbx.example.com" },
      { key: "PBX_GATEWAY_TOKEN", label: "PBX ağ geçidi anahtarı", secret: true },
    ],
  },
  {
    id: "evolution",
    title: "WhatsApp QR (Evolution API)",
    description: "Çoklu WhatsApp cihaz oturumu, QR eşleştirme ve medya.",
    test: "evolution",
    fields: [
      { key: "EVOLUTION_API_URL", label: "Evolution API adresi", placeholder: "https://wa.xre.com.tr" },
      { key: "EVOLUTION_API_KEY", label: "Evolution API anahtarı", secret: true },
      { key: "EVOLUTION_WEBHOOK_SECRET", label: "Webhook sırrı", secret: true },
      { key: "EVOLUTION_WEBHOOK_URL", label: "Webhook adresi (opsiyonel)", placeholder: "https://crm.xre.com.tr/api/webhooks/evolution" },
      { key: "WHATSAPP_AUTO_LEAD", label: "Gelen mesajda otomatik müşteri aç", placeholder: "0", help: "0: WhatCRM gibi, kayıtsız sohbet olarak kalır (varsayılan). 1: her yeni numara için müşteri kartı açılır." },
      { key: "WHATSAPP_DAILY_NEW_CONTACTS", label: "Günlük yeni kişi sınırı (hat başına)", placeholder: "40", help: "QR hatlarında ban riskini azaltmak için günde ilk mesaj atılabilecek yeni kişi sayısı." },
      { key: "WHATSAPP_MIN_INTERVAL_MS", label: "Mesajlar arası en az süre (ms)", placeholder: "1500" },
    ],
  },
  {
    id: "meta",
    title: "WhatsApp Cloud API (Meta)",
    description: "Resmî WhatsApp Business API.",
    test: "meta",
    fields: [
      { key: "META_ACCESS_TOKEN", label: "Kalıcı erişim anahtarı", secret: true },
      { key: "META_APP_SECRET", label: "Uygulama gizli anahtarı", secret: true },
      { key: "META_VERIFY_TOKEN", label: "Webhook doğrulama anahtarı", secret: true },
      { key: "META_LINE_MAP_JSON", label: "Hat eşleme (JSON)", multiline: true, placeholder: '{"office-2":"123456789012345"}' },
      { key: "META_WABA_ID", label: "WhatsApp Business Hesap ID", placeholder: "1234567890", help: "Onaylı şablonları listelemek için gerekli." },
    ],
  },
  {
    id: "vapi",
    title: "Vapi AI aramaları",
    description: "Yapay zekâ asistanıyla giden/gelen aramalar.",
    test: "vapi",
    fields: [
      { key: "VAPI_API_KEY", label: "Vapi API anahtarı", secret: true },
      { key: "VAPI_ASSISTANT_ID", label: "Varsayılan asistan ID" },
      { key: "VAPI_WEBHOOK_SECRET", label: "Webhook sırrı", secret: true },
      { key: "VAPI_LINE_MAP_JSON", label: "Hat eşleme (JSON)", multiline: true, placeholder: '{"ai-1":"vapi-phone-number-id"}' },
    ],
  },
  {
    id: "ai",
    title: "Yapay zekâ asistanı ve n8n",
    description: "CRM asistanı (OpenAI) ve n8n Public API.",
    fields: [
      { key: "XRE_OPENAI_API_KEY", label: "OpenAI API anahtarı", secret: true },
      { key: "N8N_API_KEY", label: "n8n API anahtarı", secret: true },
    ],
  },
  {
    id: "bitrix",
    title: "Bitrix24",
    description: "Aktarım ve mevcut Bitrix uygulaması için gelen webhook.",
    test: "bitrix",
    fields: [
      { key: "BITRIX_DOMAIN", label: "Bitrix alan adı", placeholder: "xre.bitrix24.com.tr" },
      { key: "BITRIX_WEBHOOK", label: "Gelen webhook URL", secret: true, placeholder: "https://xre.bitrix24.com.tr/rest/1/xxxx/" },
      { key: "BITRIX_AUTO_ACCOUNTS", label: "Bitrix kullanıcılarına otomatik hesap", placeholder: "1", help: "1 (varsayılan): Bitrix'ten ilk girişte CRM hesabı kendiliğinden açılır; Bitrix yöneticileri Yönetici, diğerleri Satış danışmanı olur. 0: yalnız elle açılan hesaplar girer." },
    ],
  },
  {
    id: "google-calendar",
    title: "Google Takvim / Meet",
    description: "Toplantı linki üretimi için OAuth istemcisi.",
    fields: [
      { key: "GOOGLE_CALENDAR_CLIENT_ID", label: "İstemci ID" },
      { key: "GOOGLE_CALENDAR_CLIENT_SECRET", label: "İstemci gizli anahtarı", secret: true },
      { key: "GOOGLE_CALENDAR_REDIRECT_URI", label: "Dönüş adresi", placeholder: "https://crm.xre.com.tr/api/google-calendar/callback" },
      { key: "GOOGLE_CALENDAR_TOKEN_KEY", label: "Token şifreleme anahtarı", secret: true, help: "En az 32 karakter rastgele değer." },
    ],
  },
  {
    id: "social",
    title: "Sosyal giriş (Google, Facebook, Apple)",
    description: "Giriş ekranındaki sosyal butonları etkinleştirir. Dönüş adresi: {origin}/api/auth/social/<google|facebook|apple>/callback",
    fields: [
      { key: "GOOGLE_OAUTH_CLIENT_ID", label: "Google istemci ID" },
      { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "Google istemci gizli anahtarı", secret: true },
      { key: "FACEBOOK_APP_ID", label: "Facebook uygulama ID" },
      { key: "FACEBOOK_APP_SECRET", label: "Facebook uygulama gizli anahtarı", secret: true },
      { key: "APPLE_CLIENT_ID", label: "Apple Services ID", placeholder: "com.xre.crm.web" },
      { key: "APPLE_TEAM_ID", label: "Apple Team ID" },
      { key: "APPLE_KEY_ID", label: "Apple Key ID" },
      { key: "APPLE_PRIVATE_KEY", label: "Apple özel anahtarı (.p8)", secret: true, multiline: true, placeholder: "-----BEGIN PRIVATE KEY-----" },
    ],
  },
  {
    id: "legacy-webhooks",
    title: "Eski genel webhook",
    description: "Webhook merkezinden önceki tekil gelen/giden webhook sırları.",
    fields: [
      { key: "INBOUND_WEBHOOK_SECRET", label: "Gelen webhook sırrı", secret: true },
      { key: "OUTBOUND_WEBHOOK_SECRET", label: "Giden imza sırrı", secret: true },
    ],
  },
];

export const SETTING_KEYS = SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
export const SECRET_KEYS = new Set(
  SETTING_GROUPS.flatMap((g) => g.fields.filter((f) => f.secret).map((f) => f.key)),
);

export interface SettingStatus {
  key: string;
  configured: boolean;
  source: "ui" | "env" | null;
  preview: string;
}

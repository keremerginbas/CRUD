export const SELECTED_WORKFLOWS = [
  {
    id: "KWD5Yr7uuz2gMlI5",
    name: "Bitrix Etkinlik Takibi",
    purpose: "Etkinlik geçmişi ve günlük ekip raporu",
    trigger: "Webhook + zamanlama",
    webhooks: [
      {
        path: "bitrix-etkinlik-takip",
        method: "POST",
        contract: "Bitrix aktivite kimliği ve OWNER_TYPE_ID/OWNER_ID",
      },
    ],
    note: "Aktivite callback’i bekler; CRM müşteri UUID’si doğrudan Bitrix aktivite kimliği değildir.",
  },
  {
    id: "0PIWrbVUIcWf7AiZ",
    name: "Call Center Performansı",
    purpose: "Satışçı, CRM ve arama denetimi",
    trigger: "Webhook + zamanlama",
    webhooks: [
      {
        path: "bitrix-crm-guncelleme",
        method: "POST",
        contract: "ONCRMLEADADD/UPDATE veya ONVOXIMPLANTCALLEND",
      },
    ],
    note: "Bitrix lead/deal kimliği ve alanları gerekir. CRM olayları için açık kimlik eşlemesi gereklidir.",
  },
  {
    id: "IDJi8fQoxPxpWU5F",
    name: "Günlük Arama Raporu",
    purpose: "Personel bazlı Bitrix arama istatistiği",
    trigger: "Zamanlama · 20:00",
    webhooks: [],
    note: "Webhook tetikleyicisi yok; mevcut yürütme çıktısı rapor olarak okunur.",
  },
  {
    id: "LD8jlJvE1LBmMeE3",
    name: "Bitrix Ekip Raporu",
    purpose: "CRM_TODO, fırsat aşamaları ve çağrı analizi",
    trigger: "Zamanlama + manuel",
    webhooks: [],
    note: "Webhook tetikleyicisi yok. Mevcut planlı çıktılar okunur; tekrar e-posta/Telegram gönderilmez.",
  },
  {
    id: "gWKseHEZL96T26iC",
    name: "XRE Bitrix Assistant v8",
    purpose: "CRM sorguları ve etkinlik denetimi",
    trigger: "Özel asistan webhooku",
    webhooks: [
      {
        path: "xre-bitrix-assistant",
        method: "POST",
        contract: "action + ilgili alanlar; ayrı x-api-key kontrolü",
      },
      {
        path: "xre-bitrix-activity-audit",
        method: "POST",
        contract: "ONCRMACTIVITYADD/UPDATE/DELETE + sayısal aktivite ID",
      },
    ],
    note: "Asistanın özel action sözleşmesi ve ayrı anahtarı vardır. n8n yönetim anahtarı webhook anahtarı olarak kullanılamaz.",
  },
  {
    id: "ImTuxSRxDugg33aI",
    name: "Günlük GROWTH Raporu",
    purpose: "Bugün/dün lead kaynak ve statü karşılaştırması",
    trigger: "Zamanlama · 20:00",
    webhooks: [],
    note: "Bitrix lead listesi üzerinden rapor üretir. Webhook yok; son başarılı rapor çıktısı okunur.",
  },
] as const;

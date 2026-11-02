const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  jwtSecret: env.JWT_SECRET ?? 'dev-secret',
  dbPath: env.DB_PATH ?? './data/santral.db',
  timezone: env.TZ_NAME ?? 'Europe/Istanbul',
  // Tarayıcı telefonu (WebRTC): panel santrale bu WebSocket adresinden bağlanır (Hestia /ws → Asterisk :8088/ws)
  sip: {
    wsUrl: env.SIP_WS_URL ?? '',
    domain: env.SIP_DOMAIN ?? '',
  },
  bitrix: {
    webhookUrl: env.BITRIX_WEBHOOK_URL ?? '',
    // Danışmanı Bitrix'te eşleşmeyen çağrılar bu kullanıcıya yazılır (boşsa yazılmaz)
    defaultUserId: env.BITRIX_DEFAULT_USER_ID ? Number(env.BITRIX_DEFAULT_USER_ID) : null,
  },
  pbx: {
    provider: env.PBX_PROVIDER ?? 'mock',
    webhookSecret: env.PBX_WEBHOOK_SECRET ?? 'dev-webhook-secret',
    logWebhooks: env.PBX_LOG_WEBHOOKS === '1',
    huntGroupDestination: env.HUNT_GROUP_DESTINATION ?? 'queue:karsilama',
    customerAnnouncement: env.CUSTOMER_ANNOUNCEMENT ?? 'danismaniniz-sizi-ariyor',
    // Gelen aramada kayıtlı müşteriye, danışmana bağlanırken çalınan anons
    callerAnnouncement: env.CALLER_ANNOUNCEMENT ?? 'satis-danismaninizi-ariyorsunuz',
    // Kayıtlı olmayan müşteri ve mesai dışı aramalar (boşsa kayıtsız müşteri de hattın sahibine gider)
    assistantDestination: env.ASSISTANT_DESTINATION ?? '',
    asterisk: {
      ariUrl: env.ASTERISK_ARI_URL ?? '',
      ariUser: env.ASTERISK_ARI_USER ?? '',
      ariPassword: env.ASTERISK_ARI_PASSWORD ?? '',
      trunk: env.ASTERISK_TRUNK ?? 'trunk',
      // Danışmanın cebini arayan bağlantı (operatör dahilisi tek görüşmeye izin veriyorsa ayrı dahili)
      agentTrunk: env.ASTERISK_AGENT_TRUNK || env.ASTERISK_TRUNK || 'trunk',
    },
    verimor: {
      apiKey: env.VERIMOR_API_KEY ?? '',
      baseUrl: env.VERIMOR_BASE_URL ?? 'https://api.bulutsantralim.com',
    },
  },
};

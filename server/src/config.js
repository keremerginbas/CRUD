const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  jwtSecret: env.JWT_SECRET ?? 'dev-secret',
  dbPath: env.DB_PATH ?? './data/santral.db',
  timezone: env.TZ_NAME ?? 'Europe/Istanbul',
  pbx: {
    provider: env.PBX_PROVIDER ?? 'mock',
    webhookSecret: env.PBX_WEBHOOK_SECRET ?? 'dev-webhook-secret',
    logWebhooks: env.PBX_LOG_WEBHOOKS === '1',
    huntGroupDestination: env.HUNT_GROUP_DESTINATION ?? 'queue:karsilama',
    customerAnnouncement: env.CUSTOMER_ANNOUNCEMENT ?? 'danismaniniz-sizi-ariyor',
    verimor: {
      apiKey: env.VERIMOR_API_KEY ?? '',
      baseUrl: env.VERIMOR_BASE_URL ?? 'https://api.bulutsantralim.com',
    },
  },
};

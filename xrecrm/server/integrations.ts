import {
  envConfigured,
  fetchWithTimeout,
  normalizePhone,
  readJsonResponse,
} from "./security.js";
import {
  getVapiCatalog,
  vapiLineIsCallable,
} from "./vapi-catalog.js";
import type { Provider } from "./types.js";

const metaBase = () =>
  (process.env.META_GRAPH_URL || "https://graph.facebook.com/v23.0").replace(
    /\/$/,
    "",
  );
export const evolutionBase = () =>
  (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
const vapiBase = () =>
  (process.env.VAPI_API_URL || "https://api.vapi.ai").replace(/\/$/, "");

function lineMap(
  envName: "META_LINE_MAP_JSON" | "VAPI_LINE_MAP_JSON",
): Record<string, string> {
  const raw = process.env[envName]?.trim();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, remote]) =>
            /^[a-z]+-(?:[1-9]|1[0-9]|2[0-3])$/.test(key) &&
            typeof remote === "string" &&
            remote.trim(),
        )
        .map(([key, remote]) => [key, String(remote).trim()]),
    );
  } catch {
    return {};
  }
}

export function resolveLineId(
  provider: "meta" | "vapi",
  logicalLineId: string,
): string {
  const envName =
    provider === "meta" ? "META_LINE_MAP_JSON" : "VAPI_LINE_MAP_JSON";
  const remote = lineMap(envName)[logicalLineId];
  if (!remote)
    throw Object.assign(
      new Error(
        `${provider === "meta" ? "Meta" : "Vapi"} hattı ${logicalLineId || "(boş)"} için açık eşleme bulunamadı.`,
      ),
      { statusCode: 503 },
    );
  return remote;
}

export function configuredLineCount(provider: "meta" | "vapi"): number {
  return Object.keys(
    lineMap(provider === "meta" ? "META_LINE_MAP_JSON" : "VAPI_LINE_MAP_JSON"),
  ).length;
}

export async function sendMetaText(
  logicalLineId: string,
  to: string,
  text: string,
): Promise<any> {
  if (!envConfigured("META_ACCESS_TOKEN", "META_LINE_MAP_JSON"))
    throw Object.assign(
      new Error("Meta WhatsApp ve META_LINE_MAP_JSON yapılandırılmamış."),
      { statusCode: 503 },
    );
  const phoneNumberId = resolveLineId("meta", logicalLineId);
  const response = await fetchWithTimeout(
    `${metaBase()}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizePhone(to),
        type: "text",
        text: { preview_url: true, body: text },
      }),
    },
  );
  return readJsonResponse(response);
}

export async function evolutionConnectionState(instance: string): Promise<any> {
  if (!envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY"))
    throw Object.assign(new Error("Evolution API yapılandırılmamış."), {
      statusCode: 503,
    });
  const response = await fetchWithTimeout(
    `${evolutionBase()}/instance/connectionState/${encodeURIComponent(instance)}`,
    { headers: { apikey: process.env.EVOLUTION_API_KEY! } },
  );
  return readJsonResponse(response);
}

/** WhatsApp JID'sinden ("905...@s.whatsapp.net" / "905...:12@...") numara. */
export function jidPhone(jid: unknown): string {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

export interface EvolutionInstanceInfo {
  name: string;
  state: string;
  phone: string;
  profileName: string;
}

/** Evolution'daki tüm oturumlar ve bağlı WhatsApp numaraları (v1 ve v2 biçimi). */
export async function evolutionInstances(): Promise<EvolutionInstanceInfo[]> {
  if (!envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY"))
    throw Object.assign(new Error("Evolution API yapılandırılmamış."), {
      statusCode: 503,
    });
  const response = await fetchWithTimeout(
    `${evolutionBase()}/instance/fetchInstances`,
    { headers: { apikey: process.env.EVOLUTION_API_KEY! } },
  );
  const data = await readJsonResponse(response);
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.instances) ? data.instances : [];
  return list
    .map((item) => {
      const i = item?.instance && typeof item.instance === "object" ? item.instance : item;
      return {
        name: String(i?.name || i?.instanceName || ""),
        state: String(i?.connectionStatus || i?.status || i?.state || "").toLowerCase(),
        phone: jidPhone(i?.ownerJid || i?.owner || i?.number || ""),
        profileName: String(i?.profileName || ""),
      };
    })
    .filter((i) => i.name);
}

/**
 * Evolution'ın gelen mesajları CRM'e iletmesi için webhook ayarı.
 * Tek adres (byEvents kapalı), gizli anahtar hem başlıkta hem adreste gönderilir.
 */
export function evolutionWebhookConfig() {
  const base =
    process.env.EVOLUTION_WEBHOOK_URL?.trim() ||
    (process.env.PUBLIC_ORIGIN?.trim()
      ? `${process.env.PUBLIC_ORIGIN.replace(/\/$/, "")}/api/webhooks/evolution`
      : "");
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!/^https?:\/\//i.test(base) || !secret) return undefined;
  const url = new URL(base);
  url.searchParams.set("token", secret);
  return {
    url: url.toString(),
    byEvents: false,
    base64: true,
    headers: { authorization: `Bearer ${secret}` },
    events: ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "QRCODE_UPDATED", "CALL"],
  };
}

export async function getEvolutionQr(instance: string): Promise<any> {
  if (!envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY"))
    throw Object.assign(
      new Error("Evolution API yapılandırılmamış. QR üretilemez."),
      { statusCode: 503 },
    );
  let existing = false;
  try {
    await evolutionConnectionState(instance);
    existing = true;
  } catch (error) {
    if (Number((error as any)?.providerStatus) !== 404) throw error;
  }
  const headers = {
    apikey: process.env.EVOLUTION_API_KEY!,
    "content-type": "application/json",
  };
  let response: Response;
  const webhook = evolutionWebhookConfig();
  if (!existing) {
    response = await fetchWithTimeout(`${evolutionBase()}/instance/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        instanceName: instance,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        ...(webhook ? { webhook } : {}),
      }),
    });
  } else {
    // Var olan oturumun webhook ayarını da güncelle (eski kurulumlar mesaj iletmiyordu).
    if (webhook)
      await fetchWithTimeout(
        `${evolutionBase()}/webhook/set/${encodeURIComponent(instance)}`,
        { method: "POST", headers, body: JSON.stringify({ webhook: { enabled: true, ...webhook } }) },
      ).catch(() => undefined);
    response = await fetchWithTimeout(
      `${evolutionBase()}/instance/connect/${encodeURIComponent(instance)}`,
      { headers },
    );
  }
  const data = await readJsonResponse(response);
  const candidate =
    data?.base64 || data?.qrcode?.base64 || data?.qrcode || data?.qr;
  if (
    typeof candidate !== "string" ||
    !candidate.trim() ||
    (!/^data:image\//i.test(candidate) && candidate.length < 100)
  )
    throw Object.assign(
      new Error(
        "Evolution sağlayıcısı gerçek QR görüntüsü döndürmedi; QR gösterilmedi.",
      ),
      { statusCode: 502 },
    );
  return /^data:image\//i.test(candidate)
    ? candidate
    : `data:image/png;base64,${candidate}`;
}

export async function sendEvolutionText(
  instance: string,
  to: string,
  text: string,
): Promise<any> {
  if (!envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY"))
    throw Object.assign(new Error("Evolution API yapılandırılmamış."), {
      statusCode: 503,
    });
  const state = await evolutionConnectionState(instance);
  const connection = String(
    state?.instance?.state || state?.state || "",
  ).toLowerCase();
  if (!["open", "connected"].includes(connection))
    throw Object.assign(
      new Error("Evolution WhatsApp instance bağlı değil; mesaj gönderilmedi."),
      { statusCode: 409 },
    );
  const response = await fetchWithTimeout(
    `${evolutionBase()}/message/sendText/${encodeURIComponent(instance)}`,
    {
      method: "POST",
      headers: {
        apikey: process.env.EVOLUTION_API_KEY!,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        number: normalizePhone(to),
        text,
        linkPreview: true,
      }),
    },
  );
  return readJsonResponse(response);
}

export async function createVapiCall(
  phone: string,
  assistantId: string,
  logicalLineId: string,
): Promise<any> {
  if (!envConfigured("VAPI_API_KEY"))
    throw Object.assign(
      new Error("Vapi API anahtarı yapılandırılmamış."),
      { statusCode: 503 },
    );
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone)
    throw Object.assign(new Error("Vapi müşteri telefonu geçersiz."), {
      statusCode: 400,
    });
  const selectedAssistant =
    assistantId.trim() || process.env.VAPI_ASSISTANT_ID?.trim() || "";
  if (!selectedAssistant)
    throw Object.assign(new Error("Vapi asistanı seçilmelidir."), {
      statusCode: 400,
    });
  if (!logicalLineId.trim())
    throw Object.assign(new Error("Vapi mantıksal hattı seçilmelidir."), {
      statusCode: 400,
    });

  const catalog = await getVapiCatalog();
  if (!catalog.assistants.some((assistant) => assistant.id === selectedAssistant))
    throw Object.assign(new Error("Seçilen Vapi asistanı bulunamadı."), {
      statusCode: 400,
    });
  const line = catalog.lines.find((candidate) => candidate.lineId === logicalLineId);
  if (!line)
    throw Object.assign(new Error("Seçilen Vapi hattı kullanılabilir değil."), {
      statusCode: 409,
    });
  if (!vapiLineIsCallable(line))
    throw Object.assign(new Error("Seçilen Vapi hattı aktif değil."), {
      statusCode: 409,
    });

  let response: Response;
  try {
    response = await fetchWithTimeout(`${vapiBase()}/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assistantId: selectedAssistant,
        phoneNumberId: line.phoneNumberId,
        customer: { number: normalizedPhone },
      }),
    });
    return await readJsonResponse(response);
  } catch {
    // Do not pass provider response JSON, prompts, URLs, or credential-like
    // metadata through the Express error handler.
    throw Object.assign(new Error("Vapi araması başlatılamadı."), {
      statusCode: 502,
    });
  }
}

export function providerConfigured(provider: Provider): boolean {
  switch (provider) {
    case "meta":
      return (
        envConfigured("META_ACCESS_TOKEN", "META_LINE_MAP_JSON") &&
        configuredLineCount("meta") > 0
      );
    case "evolution":
      return envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY");
    case "vapi":
      return envConfigured("VAPI_API_KEY");
    case "netgsm":
      return envConfigured(
        "NETGSM_SIP_HOST",
        "NETGSM_SIP_USERNAME",
        "NETGSM_SIP_PASSWORD",
        "PBX_GATEWAY_URL",
        "PBX_GATEWAY_TOKEN",
      );
    case "bitrix":
      return envConfigured("BITRIX_DOMAIN", "BITRIX_WEBHOOK");
    case "webhook":
      return (
        envConfigured("INBOUND_WEBHOOK_SECRET") ||
        envConfigured("OUTBOUND_WEBHOOK_SECRET")
      );
  }
}

export async function testProvider(provider: Provider): Promise<unknown> {
  if (!providerConfigured(provider))
    throw Object.assign(new Error(`${provider} yapılandırılmamış.`), {
      statusCode: 503,
    });
  if (provider === "meta") {
    const logical = Object.keys(lineMap("META_LINE_MAP_JSON"))[0];
    const response = await fetchWithTimeout(
      `${metaBase()}/${encodeURIComponent(resolveLineId("meta", logical))}?fields=id,display_phone_number`,
      { headers: { authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } },
    );
    return readJsonResponse(response);
  }
  if (provider === "evolution") {
    const response = await fetchWithTimeout(
      `${evolutionBase()}/instance/fetchInstances`,
      { headers: { apikey: process.env.EVOLUTION_API_KEY! } },
    );
    return readJsonResponse(response);
  }
  if (provider === "vapi") {
    const catalog = await getVapiCatalog();
    const defaultAssistantId = process.env.VAPI_ASSISTANT_ID?.trim();
    return {
      assistantCount: catalog.assistants.length,
      matchedLineCount: catalog.lines.length,
      accountVerified: true,
      webhookConfigured: catalog.webhookConfigured,
      defaultAssistantConfigured: Boolean(
        defaultAssistantId &&
          catalog.assistants.some(
            (assistant) => assistant.id === defaultAssistantId,
          ),
      ),
    };
  }
  if (provider === "netgsm") {
    const base = process.env.PBX_GATEWAY_URL!.replace(/\/$/, "");
    const response = await fetchWithTimeout(`${base}/health`, {
      headers: { authorization: `Bearer ${process.env.PBX_GATEWAY_TOKEN}` },
    });
    return readJsonResponse(response);
  }
  if (provider === "webhook") return { configured: true, readOnly: true };
  const webhookBase = process.env.BITRIX_WEBHOOK!.replace(/\/$/, "");
  const response = await fetchWithTimeout(`${webhookBase}/user.current.json`);
  return readJsonResponse(response);
}

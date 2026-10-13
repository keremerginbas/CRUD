import { fetchWithTimeout, readJsonResponse } from "./security.js";

const safePlacement = new Set([
  "CRM_LEAD_DETAIL_TAB",
  "CRM_CONTACT_DETAIL_TAB",
  "CRM_DEAL_DETAIL_TAB",
  "CRM_COMPANY_DETAIL_TAB",
]);

export async function verifyBitrixContext(
  authId: string,
  placement: string,
  placementOptions: unknown,
): Promise<Record<string, unknown>> {
  if (!authId || authId.length > 4096)
    throw Object.assign(new Error("Bitrix AUTH_ID gerekli."), {
      statusCode: 401,
    });
  if (!safePlacement.has(placement))
    throw Object.assign(new Error("Bitrix placement izinli değil."), {
      statusCode: 400,
    });
  const domain = String(process.env.BITRIX_DOMAIN || "").trim();
  if (!domain || !process.env.BITRIX_WEBHOOK)
    throw Object.assign(new Error("Bitrix doğrulama ayarları eksik."), {
      statusCode: 503,
    });
  let parsedOptions: unknown = placementOptions;
  if (typeof placementOptions === "string") {
    if (placementOptions.length > 10000)
      throw Object.assign(new Error("Bitrix context çok büyük."), {
        statusCode: 400,
      });
    try {
      parsedOptions = JSON.parse(placementOptions);
    } catch {
      parsedOptions = { raw: placementOptions.slice(0, 1000) };
    }
  }
  const url = `https://${domain}/rest/user.current.json?auth=${encodeURIComponent(authId)}`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  const data = await readJsonResponse(response);
  if (!data?.result?.ID)
    throw Object.assign(new Error("Bitrix AUTH_ID doğrulanamadı."), {
      statusCode: 401,
    });
  return {
    placement,
    options: parsedOptions,
    bitrixUser: {
      id: String(data.result.ID),
      name: [data.result.NAME, data.result.LAST_NAME].filter(Boolean).join(" "),
      email: data.result.EMAIL || null,
    },
  };
}

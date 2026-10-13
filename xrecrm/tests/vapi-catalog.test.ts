import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "104.18.0.1", family: 4 }]),
}));

import {
  getVapiCatalog,
  VapiCatalogError,
} from "../server/vapi-catalog.js";
import {
  createVapiCall,
  providerConfigured,
  testProvider,
} from "../server/integrations.js";

const savedEnv = { ...process.env };
const key = "test-vapi-key";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installCatalogFetch(options: {
  assistants?: unknown;
  phoneNumbers?: unknown;
  call?: unknown;
  phoneStatus?: number;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/assistant?limit=1000"))
      return response(options.assistants ?? [{ id: "asst-1", name: "Satış" }]);
    if (url.includes("/phone-number?limit=1000"))
      return response(
        options.phoneNumbers ?? [
          {
            id: "phone-ai-1",
            number: "+905551000001",
            assistantId: "asst-inbound",
            status: "active",
          },
        ],
        options.phoneStatus ?? 200,
      );
    if (url.endsWith("/call")) return response(options.call ?? { id: "call-1" });
    throw new Error(`unexpected URL ${url} ${init?.method || "GET"}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.VAPI_API_KEY = key;
  delete process.env.VAPI_API_URL;
  delete process.env.VAPI_LINE_MAP_JSON;
  delete process.env.VAPI_ASSISTANT_ID;
  delete process.env.VAPI_WEBHOOK_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of Object.keys(process.env))
    if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
});

describe("VAPI catalog", () => {
  it("matches exact CRM phones, keeps duplicate numbers unavailable, and omits provider metadata", async () => {
    installCatalogFetch({
      assistants: [
        {
          id: "asst-1",
          name: "Satış",
          model: { messages: [{ content: "private prompt" }] },
          serverUrl: "https://private.example/token",
        },
      ],
      phoneNumbers: [
        {
          id: "phone-ai-1",
          number: "+90 555 100 0001",
          name: "AI bir",
          assistantId: "asst-inbound",
          status: "active",
        },
        {
          id: "phone-ai-duplicate",
          number: "0555 100 0001",
          name: "AI duplicate",
          status: "active",
        },
        {
          id: "phone-cloud-1",
          number: "+905553000001",
          credentialId: "credential-1",
        },
        {
          id: "phone-unknown",
          number: "+905551111111",
          credentialId: "credential-unknown",
        },
      ],
    });

    const catalog = await getVapiCatalog();
    expect(catalog.keyConfigured).toBe(true);
    expect(catalog.assistants).toEqual([{ id: "asst-1", name: "Satış" }]);
    expect(catalog.lines).toEqual([
      expect.objectContaining({
        lineId: "cloud-1",
        phoneNumberId: "phone-cloud-1",
        phone: "+905553000001",
        group: "cloud",
        credentialConfigured: true,
      }),
    ]);
    expect(catalog.unavailableLineIds).toContain("ai-1");
    expect(catalog.unmatchedNumbers).toBe(3);
    expect(JSON.stringify(catalog)).not.toContain("private prompt");
    expect(JSON.stringify(catalog)).not.toContain("private.example");
  });

  it("rejects an explicit map whose remote id does not match the logical inventory phone", async () => {
    installCatalogFetch();
    process.env.VAPI_LINE_MAP_JSON = JSON.stringify({
      "office-1": "phone-ai-1",
    });

    await expect(getVapiCatalog()).rejects.toMatchObject({ statusCode: 503 });
  });

  it("rejects duplicate explicit remote ids", async () => {
    installCatalogFetch({
      phoneNumbers: [
        { id: "phone-1", number: "+905551000001" },
        { id: "phone-2", number: "+905551000002" },
      ],
    });
    process.env.VAPI_LINE_MAP_JSON = JSON.stringify({
      "ai-1": "phone-1",
      "ai-2": "phone-1",
    });

    await expect(getVapiCatalog()).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("VAPI calls and provider test", () => {
  it("reports configured with only the API key and returns a sanitized read-only result", async () => {
    installCatalogFetch({
      assistants: [
        {
          id: "asst-1",
          name: "Satış",
          model: { messages: [{ content: "private prompt" }] },
          serverUrl: "https://private.example/token",
        },
      ],
    });

    expect(providerConfigured("vapi")).toBe(true);
    const result = await testProvider("vapi");
    expect(result).toEqual({
      assistantCount: 1,
      matchedLineCount: 1,
      accountVerified: true,
      webhookConfigured: false,
      defaultAssistantConfigured: false,
    });
    expect(JSON.stringify(result)).not.toContain("private prompt");
    expect(JSON.stringify(result)).not.toContain("private.example");
  });

  it("validates the selected assistant before POST /call", async () => {
    const fetchMock = installCatalogFetch();

    await expect(
      createVapiCall("+905550000010", "unknown-assistant", "ai-1"),
    ).rejects.toThrow("bulunamadı");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/call"))).toBe(
      false,
    );
  });

  it("posts only the selected verified assistant, line, and customer number", async () => {
    const fetchMock = installCatalogFetch({
      assistants: [
        {
          id: "asst-1",
          name: "Satış",
          model: { messages: [{ content: "private prompt" }] },
          serverUrl: "https://private.example/token",
        },
      ],
      phoneNumbers: [
        {
          id: "phone-ai-1",
          number: "+905551000001",
          assistantId: "asst-inbound",
        },
      ],
      call: { id: "call-1", status: "queued" },
    });

    await createVapiCall("0555 100 0001", "asst-1", "ai-1");
    const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/call"));
    expect(call).toBeDefined();
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toEqual({
      assistantId: "asst-1",
      phoneNumberId: "phone-ai-1",
      customer: { number: "905551000001" },
    });
    expect(JSON.stringify(body)).not.toContain("private prompt");
    expect(JSON.stringify(body)).not.toContain("private.example");
  });

  it("turns provider failures into a generic error without provider JSON", async () => {
    installCatalogFetch({
      phoneStatus: 403,
      phoneNumbers: {
        error: {
          message: "private prompt and https://private.example/token",
        },
      },
    });
    await expect(getVapiCatalog()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(VapiCatalogError);
      expect((error as Error).message).toBe("Vapi kataloğu alınamadı.");
      expect((error as Error).message).not.toContain("private.example");
      return true;
    });
  });
});

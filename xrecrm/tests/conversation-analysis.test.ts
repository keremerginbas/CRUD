import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../server/db";
import {
  processConversationAnalysisEvent,
  scheduleConversationAnalysis,
} from "../server/conversation-analysis";

type AnyRecord = Record<string, any>;

const analysisJson = {
  summary: "Müşteri teklif hakkında bilgi istedi.",
  customerIntent: "Teklifi değerlendirmek",
  outcome: "Takip gerekli",
  nextSteps: "Teklif gönderilip geri dönüş sorulmalı",
  confidence: "high",
};

function providerResponse() {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(analysisJson) } }],
    }),
  };
}

async function lead(
  store: ReturnType<typeof createMemoryStore>,
  owner = "owner-1",
  id = "lead-1",
) {
  await store.put(
    "lead",
    id,
    {
      id,
      name: "Sentetik Müşteri",
      owner,
      contactId: "contact-1",
      stage: "new",
    },
    owner,
  );
}

beforeEach(() => {
  process.env.XRE_OPENAI_API_KEY = "test-key-not-real";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => providerResponse()),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.XRE_OPENAI_API_KEY;
});

describe("conversation analysis", () => {
  it("is idempotent: duplicate queue and duplicate worker create one feed post", async () => {
    const store = createMemoryStore();
    await lead(store);
    await store.put(
      "call",
      "call-1",
      {
        id: "call-1",
        leadId: "lead-1",
        status: "completed",
        transcript: "Merhaba, teklifinizi incelemek istiyorum.",
        createdAt: new Date().toISOString(),
      },
      "owner-1",
    );

    const first = await scheduleConversationAnalysis(
      store,
      "owner-1",
      "call",
      "call-1",
    );
    const duplicate = await scheduleConversationAnalysis(
      store,
      "owner-1",
      "call",
      "call-1",
    );
    expect(duplicate).toBe(first);
    const event = (await store.listEvents("owner-1"))[0];
    expect((event.payload as AnyRecord).type).toBe("conversation-analysis");
    await processConversationAnalysisEvent(store, event);
    await processConversationAnalysisEvent(store, event);
    expect(await store.list("feed", "owner-1")).toHaveLength(1);
    expect((await store.list("feed", "owner-1"))[0].id).toMatch(
      /^ai-analysis-/,
    );
  });

  it("does not call the provider or invent analysis without call text", async () => {
    const store = createMemoryStore();
    await lead(store);
    await store.put(
      "call",
      "call-empty",
      {
        id: "call-empty",
        leadId: "lead-1",
        status: "completed",
        audioUrl: "https://audio.invalid/never-fetch",
      },
      "owner-1",
    );
    const eventId = await scheduleConversationAnalysis(
      store,
      "owner-1",
      "call",
      "call-empty",
    );
    const event = (await store.getEvent(eventId, "owner-1"))!;
    const result = await processConversationAnalysisEvent(store, event);
    expect(result.status).toBe("missing_transcript");
    expect(fetch).not.toHaveBeenCalled();
    expect(await store.list("feed", "owner-1")).toHaveLength(0);
    expect(
      (
        (await store.list<AnyRecord>("conversation_analysis", "owner-1"))[0]
          .payload as AnyRecord
      ).status,
    ).toBe("missing_transcript");
  });

  it("queues a new event when a transcript version changes", async () => {
    const store = createMemoryStore();
    await lead(store);
    await store.put(
      "call",
      "call-version",
      { id: "call-version", leadId: "lead-1", transcript: "İlk kayıt" },
      "owner-1",
    );
    const first = await scheduleConversationAnalysis(
      store,
      "owner-1",
      "call",
      "call-version",
    );
    await store.put(
      "call",
      "call-version",
      {
        id: "call-version",
        leadId: "lead-1",
        transcript: "Güncellenmiş kayıt",
      },
      "owner-1",
    );
    const second = await scheduleConversationAnalysis(
      store,
      "owner-1",
      "call",
      "call-version",
    );
    expect(second).not.toBe(first);
    expect(await store.listEvents("owner-1")).toHaveLength(2);
  });

  it("includes inbound/outbound timestamps while redacting secrets in WhatsApp context", async () => {
    const store = createMemoryStore();
    await lead(store);
    await store.put(
      "message",
      "msg-in",
      {
        id: "msg-in",
        leadId: "lead-1",
        direction: "inbound",
        text: "Merhaba sk-test-secret-token-123456789",
        createdAt: "2026-01-01T10:00:00.000Z",
      },
      "owner-1",
    );
    await store.put(
      "message",
      "msg-out",
      {
        id: "msg-out",
        leadId: "lead-1",
        direction: "outbound",
        text: "Size yarın döneceğim",
        createdAt: "2026-01-01T10:01:00.000Z",
      },
      "owner-1",
    );
    const eventId = await scheduleConversationAnalysis(
      store,
      "owner-1",
      "whatsapp",
      "msg-in",
    );
    await processConversationAnalysisEvent(
      store,
      (await store.getEvent(eventId, "owner-1"))!,
    );
    const body = JSON.parse(String((fetch as AnyRecord).mock.calls[0][1].body));
    const prompt = String(body.messages[1].content);
    expect(prompt).toContain("2026-01-01T10:00:00.000Z");
    expect(prompt).toContain("2026-01-01T10:01:00.000Z");
    expect(prompt).toContain("inbound");
    expect(prompt).toContain("outbound");
    expect(prompt).not.toContain("sk-test-secret-token-123456789");
    expect(prompt).toContain("[gizli değer]");
  });

  it("reloads a worker source through the event owner scope", async () => {
    const store = createMemoryStore();
    await lead(store, "owner-a", "lead-a");
    await lead(store, "owner-b", "lead-b");
    await store.put(
      "call",
      "same-id",
      { id: "same-id", leadId: "lead-a", transcript: "A sahibi metni" },
      "owner-a",
    );
    await store.put(
      "call",
      "same-id",
      { id: "same-id", leadId: "lead-b", transcript: "B sahibi metni" },
      "owner-b",
    );
    const eventId = await scheduleConversationAnalysis(
      store,
      "owner-a",
      "call",
      "same-id",
    );
    const event = (await store.getEvent(eventId, "owner-a"))!;
    await processConversationAnalysisEvent(store, event);
    expect(await store.list("feed", "owner-a")).toHaveLength(1);
    expect(await store.list("feed", "owner-b")).toHaveLength(0);
  });
  it("ilişkisiz WhatsApp kaynakları başka müşterinin bağlamına alınmaz", async () => {
    const store = createMemoryStore();
    await store.put(
      "message",
      "one",
      { id: "one", text: "A müşterisi metni" },
      "o",
    );
    await store.put(
      "message",
      "two",
      { id: "two", text: "B gizli müşterisi metni" },
      "o",
    );
    const id = await scheduleConversationAnalysis(
      store,
      "o",
      "whatsapp",
      "one",
    );
    const result = await processConversationAnalysisEvent(
      store,
      (await store.getEvent(id, "o"))!,
    );
    expect(result.status).toBe("missing_source");
    expect(fetch).not.toHaveBeenCalled();
    expect(await store.list("feed", "o")).toHaveLength(0);
  });
});

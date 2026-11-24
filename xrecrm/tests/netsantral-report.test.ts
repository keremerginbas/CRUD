import { afterEach, beforeEach, expect, it } from "vitest";
import { createMemoryStore } from "../server/db";
import { parseReport, reportDate, reportStamp, syncNetsantralReport, transcribeCall } from "../server/netsantral-report";

const savedEnv = { ...process.env };
beforeEach(() => {
  for (const key of Object.keys(process.env)) if (/^(NETSANTRAL_|XRE_CALL_)/.test(key)) delete process.env[key];
  process.env.NETSANTRAL_PBX_NUMBER = "8500000000";
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

// Netgsm belgesindeki örnek biçim; değerler uydurmadır.
const sample = (uid: string, v: Record<string, unknown>) => ({ uniqueid: uid, values: [{ date: "24.11.2026 16:40:10", destination: "05550000001", source: "125", duration: 54, direction: 0, recording: "https://dosyaindir.netgsm.com.tr/upload.php?tip=1&a=abc", line: "5330000001", ...v }] });

it("rapor tarihleri İstanbul saatiyle okunur ve yazılır", () => {
  expect(reportDate("24.11.2026 16:40:10")).toBe("2026-11-24T13:40:10.000Z");
  expect(reportDate("bozuk")).toBeNull();
  expect(reportStamp(new Date("2026-11-24T13:40:10.000Z"))).toBe("241120261640");
});

it("rapor satırları ayrıştırılır; yabancı adresteki kayıt bağlantısı atılır", () => {
  const rows = parseReport([sample("sip3-1700000300.1", {}), sample("sip3-1700000301.1", { recording: "https://kotu.example.test/a.mp3" }), "bozuk", { uniqueid: "x" }]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ uid: "1700000300.1", source: "125", destination: "05550000001", duration: 54, line: "5330000001" });
  expect(rows[0].recording).toContain("dosyaindir.netgsm.com.tr");
  expect(rows[1].recording).toBe("");
  expect(parseReport({ code: 40, error: "Kayit bulunamadi" })).toEqual([]);
});

it("tarayıcıdan yapılan aramaya süre ve ses kaydı eklenir; ikinci kayıt oluşmaz; süzgeç dışı görüşme alınmaz", async () => {
  const store = createMemoryStore();
  const owner = "owner-1";
  const now = new Date("2026-11-24T13:45:00.000Z");
  // Tarayıcı telefonunun yazdığı kayıt (süre 7 sn, kayıt yok).
  await store.put("call", "pbx-web-u1-s1", { id: "pbx-web-u1-s1", provider: "webphone", direction: "outbound", status: "ended", phone: "905550000001", leadId: "lead-1", agent: "125", durationSeconds: 7, startedAt: "2026-11-24T13:40:00.000Z", createdAt: "2026-11-24T13:40:20.000Z" }, owner);
  process.env.NETSANTRAL_ONLY = "125, 5330000001";
  const logged: Record<string, unknown>[] = [];
  const deps = {
    ownerScope: async () => owner,
    logCall: async (o: string, input: Record<string, unknown>) => {
      logged.push(input);
      await store.put("call", `pbx-${input.callId}`, { id: `pbx-${input.callId}`, provider: "netsantral", phone: "90" + String(input.phone).replace(/\D/g, "").slice(-10), direction: input.direction, status: "ended", durationSeconds: input.durationSeconds, recording: input.recordingUrl, startedAt: input.startedAt }, o);
    },
    analyze: async () => undefined,
  };
  const rows = parseReport([
    sample("sip3-1700000300.1", {}), // tarayıcı aramasının raporu
    sample("sip3-1700000301.1", { source: "205", destination: "05550000002", line: "8500000000" }), // başka dahili: alınmaz
    sample("sip3-1700000302.1", { source: "05550000003", destination: "125", duration: 0, recording: "" }), // 125'e gelen cevapsız arama
  ]);
  const first = await syncNetsantralReport(store, deps, now, rows);
  expect(first).toEqual({ matched: 1, created: 1, transcribed: 0 });
  const web = (await store.get<any>("call", "pbx-web-u1-s1", owner))!.payload;
  expect(web).toMatchObject({ provider: "webphone", durationSeconds: 54, providerCallId: "1700000300.1", leadId: "lead-1" });
  expect(web.recording).toContain("dosyaindir.netgsm.com.tr");
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ callId: "1700000302.1", direction: "inbound", status: "no-answer", agent: "125", createLead: true });
  expect(JSON.stringify(await store.list("call", owner))).not.toContain("0000002");
  // Aynı rapor yeniden gelince hiçbir şey değişmez.
  expect(await syncNetsantralReport(store, deps, now, rows)).toEqual({ matched: 0, created: 0, transcribed: 0 });
  expect((await store.list("call", owner)).length).toBe(2);
});

it("CRM'den başlatılıp sonucu bilinmeyen arama rapora göre kapanır", async () => {
  const store = createMemoryStore();
  const owner = "owner-1";
  const now = new Date("2026-11-24T13:45:00.000Z");
  await store.put("call", "pbx-orig-1", { id: "pbx-orig-1", provider: "netsantral", direction: "outbound", status: "queued", phone: "905550000001", startedAt: "2026-11-24T13:39:30.000Z" }, owner);
  await store.put("call", "pbx-orig-2", { id: "pbx-orig-2", provider: "netsantral", direction: "outbound", status: "queued", phone: "905550000009", startedAt: "2026-11-24T13:39:30.000Z" }, owner);
  const deps = { ownerScope: async () => owner, logCall: async () => undefined, analyze: async () => undefined };
  await syncNetsantralReport(store, deps, now, parseReport([sample("sip3-1700000310.1", { duration: 0, recording: "" })]));
  expect((await store.get<any>("call", "pbx-orig-1", owner))!.payload).toMatchObject({ status: "missed", durationSeconds: 0 });
  expect((await store.get<any>("call", "pbx-orig-2", owner))!.payload.status).toBe("queued");
});

it("kaydı olmayan ya da zaten yazıya dökülmüş görüşme yeniden işlenmez", async () => {
  const store = createMemoryStore();
  await store.put("call", "c1", { id: "c1", phone: "905550000001" }, "o");
  await store.put("call", "c2", { id: "c2", phone: "905550000001", recording: "https://dosyaindir.netgsm.com.tr/upload.php?a=1", transcript: "Merhaba" }, "o");
  const analyze = async () => undefined;
  expect(await transcribeCall(store, "o", "c1", analyze)).toBe("skipped");
  expect(await transcribeCall(store, "o", "c2", analyze)).toBe("skipped");
  expect(await transcribeCall(store, "o", "yok", analyze)).toBe("skipped");
});

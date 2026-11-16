import { beforeEach, expect, it } from "vitest";
import { createMemoryStore, type Store } from "../server/db";
import { isHiddenMessage, learnWaLid, resetWaLidCache, resolveWaPeer, saveLidPhone } from "../server/wa-lid";

const OWNER = "owner-1";
const LINE = "cloud-1";
const LID = "108460000000001";
let store: Store;
const put = (id: string, fields: Record<string, unknown>) => store.put("message", id, { id, lineId: LINE, createdAt: new Date().toISOString(), ...fields }, OWNER);
const phones = async () => (await store.list<any>("message", OWNER)).map((r) => `${r.payload.id}:${r.payload.phone}`).sort();

beforeEach(async () => {
  store = createMemoryStore();
  resetWaLidCache();
  delete process.env.EVOLUTION_API_URL;
  await store.put("connection", LINE, { status: "connected", phone: "905550000099" }, OWNER);
});

it("numaralı sohbet olduğu gibi döner", async () => {
  expect(await resolveWaPeer(store, OWNER, LINE, { remoteJid: "905550000001@s.whatsapp.net" }, {})).toEqual({ phone: "905550000001", hidden: false });
});

it("gizli kimlik, mesajla birlikte gelen gerçek numaraya çevrilir; kendi hattımız numara sanılmaz", async () => {
  const key = { remoteJid: `${LID}@lid`, remoteJidAlt: "905550000001@s.whatsapp.net" };
  expect(await resolveWaPeer(store, OWNER, LINE, key, { owner: "905550000099@s.whatsapp.net" })).toEqual({ phone: "905550000001", hidden: false });
  // Sonraki mesajda numara gelmese de eşleşme hatırlanır.
  expect(await resolveWaPeer(store, OWNER, LINE, { remoteJid: `${LID}@lid` }, {})).toEqual({ phone: "905550000001", hidden: false });
  // Yalnız kendi numaramız varsa gizli kalır.
  expect(await resolveWaPeer(store, OWNER, LINE, { remoteJid: "108460000000002@lid" }, { sender: "905550000099@s.whatsapp.net" })).toEqual({ phone: "108460000000002", hidden: true });
  // Mesaj içeriğindeki numaralar (ör. iletilen kişi kartı) dikkate alınmaz.
  expect((await resolveWaPeer(store, OWNER, LINE, { remoteJid: "108460000000003@lid" }, { message: { contact: "905550000055@s.whatsapp.net" } })).hidden).toBe(true);
});

it("tek aday varsa yanıt o sohbete bağlanır ve bölünmüş eski mesajlar birleşir", async () => {
  await put("out-1", { phone: "905550000001", direction: "outbound", leadId: "lead-1" });
  await put("old-in", { phone: LID, direction: "inbound", payload: { key: { remoteJid: `${LID}@lid` } } });
  // Tahmin kapalıyken (telefondan giden mesaj) gizli kalır.
  expect((await resolveWaPeer(store, OWNER, LINE, { remoteJid: `${LID}@lid` }, {})).hidden).toBe(true);
  expect(await resolveWaPeer(store, OWNER, LINE, { remoteJid: `${LID}@lid` }, {}, { guess: true })).toEqual({ phone: "905550000001", hidden: false });
  expect(await phones()).toEqual(["old-in:905550000001", "out-1:905550000001"]);
  const moved = (await store.get<any>("message", "old-in", OWNER))!.payload;
  expect(moved.hidden).toBe(false);
  expect(isHiddenMessage({ ...moved, payload: undefined })).toBe(false);
});

it("iki aday varsa tahmin edilmez", async () => {
  await put("out-1", { phone: "905550000001", direction: "outbound" });
  await put("out-2", { phone: "905550000002", direction: "outbound" });
  expect(await resolveWaPeer(store, OWNER, LINE, { remoteJid: `${LID}@lid` }, {}, { guess: true })).toEqual({ phone: LID, hidden: true });
});

it("yanıt almış ya da başka hattaki sohbet aday sayılmaz", async () => {
  await put("out-1", { phone: "905550000001", direction: "outbound", createdAt: "2026-01-01T10:00:00.000Z" });
  await put("out-2", { phone: "905550000002", direction: "outbound", createdAt: new Date(Date.now() - 60_000).toISOString() });
  await put("in-2", { phone: "905550000002", direction: "inbound" });
  await put("out-3", { phone: "905550000003", direction: "outbound", lineId: "cloud-2" });
  expect((await resolveWaPeer(store, OWNER, LINE, { remoteJid: `${LID}@lid` }, {}, { guess: true })).hidden).toBe(true);
});

it("gönderim yanıtındaki gizli kimlik öğrenilir; yalnız aynı hattın gizli mesajları taşınır", async () => {
  await put("in-1", { phone: LID, direction: "inbound", hidden: true });
  await put("in-diger-hat", { phone: LID, direction: "inbound", hidden: true, lineId: "cloud-2" });
  await put("gercek", { phone: LID, direction: "inbound" }); // gizli işaretli değil: dokunulmaz
  await learnWaLid(store, OWNER, LINE, "0555 000 00 01", { key: { remoteJid: `${LID}@lid`, id: "X" } });
  expect(await phones()).toEqual([`gercek:${LID}`, `in-1:905550000001`, `in-diger-hat:${LID}`]);
  expect(await resolveWaPeer(store, OWNER, LINE, { remoteJid: `${LID}@lid` }, {})).toEqual({ phone: "905550000001", hidden: false });
  expect(await saveLidPhone(store, OWNER, LINE, LID, LID)).toBe(0);
});

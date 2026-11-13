import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { resetSignupAttempts, workspaceBySlug } from "../server/workspaces";
import { projectImageDir, sniffImage } from "../server/projects";
import { defaultRole } from "../shared/access";
import { PROJECT_IMAGE_MAX_BYTES, PROJECT_KIND, UNIT_KIND } from "../shared/real-estate";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
let dataDir = "";

beforeEach(async () => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_SIGNUP_VERIFY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "XRE_PROJECT_IMAGE_QUOTA_MB"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "projects-test-secret-0123456789abcdef";
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xre-projects-test-"));
  process.env.XRE_DATA_DIR = dataDir;
  resetSignupAttempts();
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await fs.rm(dataDir, { recursive: true, force: true });
});

type Call = (method: string, path: string, body?: unknown) => Promise<Response>;
async function listen(store = createMemoryStore()) {
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const make =
    (cookie: string): Call =>
    (method, url, body) =>
      fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const upload = (cookie: string, bytes: Uint8Array, type = "image/png") =>
    fetch(`${base}/api/project-images`, { method: "POST", headers: { "content-type": type, cookie }, body: new Blob([bytes as BlobPart]) });
  /** fetch yolu normalleştirdiği için gezinme denemeleri ham istekle yapılır. */
  const rawGet = (cookie: string, rawPath: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET", headers: { cookie } }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
  return { store, base, make, upload, rawGet };
}
const cookieOf = (res: Response) => (res.headers.get("set-cookie") || "").split(";")[0];

/** Varsayılan alan (A) + kayıtla açılan firma (B). */
async function twoWorkspaces() {
  process.env.XRE_SIGNUP = "1";
  const ctx = await listen();
  const json = { "content-type": "application/json" };
  const setup = await fetch(`${ctx.base}/api/auth/setup`, { method: "POST", headers: json, body: JSON.stringify({ name: "Sistem Sahibi", email: "sahip@xre.test", password: "Yonetici123" }) });
  expect(setup.status).toBe(201);
  const signup = await fetch(`${ctx.base}/api/workspaces/signup`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ company: "Örnek Yapı", slug: "ornek-yapi", name: "Deniz Örnek", email: "deniz@ornek.test", password: "Deneme1234" }),
  });
  expect(signup.status).toBe(201);
  const cookieA = cookieOf(setup);
  const cookieB = cookieOf(signup);
  return { ...ctx, cookieA, cookieB, a: ctx.make(cookieA), b: ctx.make(cookieB) };
}

const png = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const webp = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const project = (name: string, extra: Record<string, unknown> = {}) => ({ name, city: "İstanbul", district: "Kartal", ...extra });
const unit = (projectId: string, unitNo: string, extra: Record<string, unknown> = {}) => ({
  projectId, block: "A", floor: 3, unitNo, type: "2+1", grossM2: 110, netM2: 92, listPrice: 4_250_000, currency: "TRY", ...extra,
});

describe("Proje ve daire envanteri — alan yalıtımı", () => {
  it("kayıtla açılan firma modülü kullanır; A ve B birbirinin proje ve dairesini göremez, değiştiremez", async () => {
    const { a, b, store } = await twoWorkspaces();
    const createdA = await a("POST", "/api/projects", project("Örnek Vadi Konutları", { id: "proje_a" }));
    expect(createdA.status).toBe(201);
    const pa = await createdA.json();
    expect(pa).toMatchObject({ id: "proje_a", status: "satışta", deliveryDate: "", developer: "", amenities: [], images: [], archived: false });
    const ua = await (await a("POST", "/api/units", unit("proje_a", "12", { id: "daire_a" }))).json();
    expect(ua).toMatchObject({ id: "daire_a", status: "müsait", features: [], notes: "", floorPlanImageUrl: "", archived: false });

    // B kendi alanında aynı kimlikle bile ayrı kayıt açar.
    const createdB = await b("POST", "/api/projects", project("Deneme Kule", { id: "proje_b" }));
    expect(createdB.status).toBe(201);
    expect((await b("POST", "/api/units", unit("proje_b", "12"))).status).toBe(201);

    const listA = await (await a("GET", "/api/projects")).json();
    const listB = await (await b("GET", "/api/projects")).json();
    expect(listA.projects.map((p: any) => p.id)).toEqual(["proje_a"]);
    expect(listA.units.map((u: any) => u.id)).toEqual(["daire_a"]);
    expect(listB.projects.map((p: any) => p.name)).toEqual(["Deneme Kule"]);
    expect(listB.units).toHaveLength(1);

    // B, A'nın kayıtlarını değiştiremez ve A'nın projesine daire bağlayamaz.
    expect((await b("PATCH", "/api/projects/proje_a", { name: "Ele geçirildi" })).status).toBe(404);
    expect((await b("PATCH", "/api/units/daire_a", { status: "satıldı" })).status).toBe(404);
    expect((await b("POST", "/api/units", unit("proje_a", "99"))).status).toBe(400);
    expect((await b("POST", "/api/units/import", { projectId: "proje_a", duplicates: "update", rows: [{ unitNo: "12", listPrice: 1 }] })).status).toBe(400);
    const own = (await b("GET", "/api/projects").then((r) => r.json())).units[0];
    expect((await b("PATCH", `/api/units/${own.id}`, { projectId: "proje_a" })).status).toBe(400);

    const after = await (await a("GET", "/api/projects")).json();
    expect(after.projects[0].name).toBe("Örnek Vadi Konutları");
    expect(after.units[0]).toMatchObject({ status: "müsait", listPrice: 4_250_000 });
    // Depoda kayıtlar ayrı sahiplerle durur.
    const ownerA = (await store.resolveOwner())!;
    const ownerB = (await workspaceBySlug(store, "ornek-yapi"))!.ownerOpenId;
    expect((await store.list(PROJECT_KIND, ownerA)).map((r) => r.id)).toEqual(["proje_a"]);
    expect((await store.list(UNIT_KIND, ownerB))).toHaveLength(1);
    // Oturumsuz erişim yok.
    const anonymous = await fetch(`${(await a("GET", "/api/projects")).url}`);
    expect(anonymous.status).toBe(401);
  });

  it("görseller yalnız kendi alanına sunulur; tür, boyut ve yol denetlenir", async () => {
    const { a, b, upload, rawGet, cookieA, cookieB, base } = await twoWorkspaces();
    const ok = await upload(cookieA, png());
    expect(ok.status).toBe(201);
    const image = await ok.json();
    expect(image.url).toMatch(/^\/api\/project-images\/[a-f0-9]{32}\.png$/);
    expect(image.contentType).toBe("image/png");
    expect((await (await upload(cookieA, jpeg(), "image/jpeg")).json()).url).toMatch(/\.jpg$/);
    // Uzantı bildirilen türden değil içerikten gelir.
    expect((await (await upload(cookieA, webp(), "image/png")).json()).url).toMatch(/\.webp$/);

    const served = await a("GET", image.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png());

    // Başka alan aynı dosya adını bilse de göremez; oturumsuz istek reddedilir.
    expect((await b("GET", image.url)).status).toBe(404);
    expect((await fetch(`${base}${image.url}`)).status).toBe(401);

    // Sihirli baytlar: bildirilen tür doğru olsa da içerik görsel değilse reddedilir.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(cookieA, svg, "image/png")).status).toBe(415);
    expect((await upload(cookieA, svg, "image/svg+xml")).status).toBe(415);
    expect((await upload(cookieA, new TextEncoder().encode("<html><script>1</script></html>"), "image/jpeg")).status).toBe(415);
    expect((await upload(cookieA, png(), "application/octet-stream")).status).toBe(415);
    expect((await upload(cookieA, new Uint8Array(0), "image/png")).status).toBe(400);
    // Boyut sınırı: 8 MB kabul, bir bayt fazlası ret.
    expect((await upload(cookieA, png(PROJECT_IMAGE_MAX_BYTES + 1))).status).toBe(413);
    expect((await upload(cookieA, png(PROJECT_IMAGE_MAX_BYTES))).status).toBe(201);
    expect((await upload("", png())).status).toBe(401);

    // Klasör dışına çıkma denemeleri: A'nın klasörünün yanına gizli bir dosya konur.
    const ownerDir = (await fs.readdir(path.join(dataDir, "project-images")))[0];
    await fs.writeFile(path.join(dataDir, "gizli.png"), png());
    await fs.writeFile(path.join(dataDir, "project-images", "gizli.png"), png());
    const name = image.url.split("/").pop()!;
    for (const attempt of [
      "/api/project-images/..%2Fgizli.png",
      "/api/project-images/..%2F..%2Fgizli.png",
      "/api/project-images/%2e%2e%2fgizli.png",
      "/api/project-images/..%5Cgizli.png",
      "/api/project-images/../gizli.png",
      `/api/project-images/..%2F${ownerDir}%2F${name}`,
      `/api/project-images/${ownerDir}%2F${name}`,
      `/api/project-images/${name}%00.png`,
      "/api/project-images/gizli.png",
      "/api/project-images/" + "a".repeat(32) + ".svg",
    ]) {
      const forA = await rawGet(cookieA, attempt);
      const forB = await rawGet(cookieB, attempt);
      expect([attempt, forA.status]).toEqual([attempt, 404]);
      expect([attempt, forB.status]).toEqual([attempt, 404]);
      expect(forA.body).not.toContain("PNG");
    }

    // Kayıtlarda yalnız yüklenen görsel yolu veya https bağlantısı kabul edilir.
    const good = await a("POST", "/api/projects", project("Görselli Proje", { images: [{ id: "g1", url: image.url, kind: "render", caption: "Dış cephe" }, { id: "g2", url: "https://ornek.example/foto.jpg", kind: "gerçek" }] }));
    expect(good.status).toBe(201);
    expect((await good.json()).images[1]).toEqual({ id: "g2", url: "https://ornek.example/foto.jpg", kind: "gerçek", caption: "" });
    for (const url of ["javascript:alert(1)", "http://ornek.example/a.png", "/api/project-images/../../etc/passwd", "data:image/svg+xml,<svg/>", "/api/state"])
      expect([url, (await a("POST", "/api/projects", project("Kötü", { images: [{ id: "x", url, kind: "render" }] }))).status]).toEqual([url, 400]);
    expect((await a("POST", "/api/projects", project("Kötü", { images: [{ id: "x", url: image.url, kind: "çizim" }] }))).status).toBe(400);
  });

  it("alan klasörü sahibe göre ayrılır ve kota aşılınca yükleme reddedilir", async () => {
    process.env.XRE_PROJECT_IMAGE_QUOTA_MB = "1";
    const { upload, cookieA } = await twoWorkspaces();
    expect(projectImageDir("local:a")).not.toBe(projectImageDir("local:b"));
    expect(path.relative(dataDir, projectImageDir("../../kaçış"))).toMatch(/^project-images[\\/][a-f0-9]{40}$/);
    expect((await upload(cookieA, png(700_000))).status).toBe(201);
    expect((await upload(cookieA, png(700_000))).status).toBe(413);
    expect(sniffImage(png())).toBe("png");
    expect(sniffImage(jpeg())).toBe("jpg");
    expect(sniffImage(webp())).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a........"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("RIFF....WAVEfmt "))).toBeNull();
  });
});

describe("Proje ve daire envanteri — kurallar", () => {
  async function single() {
    const { a } = await twoWorkspaces();
    expect((await a("POST", "/api/projects", project("Örnek Vadi Konutları", { id: "p1" }))).status).toBe(201);
    expect((await a("POST", "/api/projects", project("Deneme Kule", { id: "p2" }))).status).toBe(201);
    return a;
  }

  it("daire kendi projesine bağlanır; blok + daire no proje içinde tekildir", async () => {
    const a = await single();
    expect((await a("POST", "/api/units", unit("yok", "1"))).status).toBe(400);
    expect((await a("POST", "/api/units", unit("p1", "12", { id: "u1" }))).status).toBe(201);
    // Aynı proje, aynı blok + no (harf ve boşluk farkı sayılmaz) → çakışma.
    const duplicate = await a("POST", "/api/units", unit("p1", " 12 ", { block: "a" }));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toBe("CONFLICT");
    // Farklı blok veya farklı proje serbest.
    expect((await a("POST", "/api/units", unit("p1", "12", { block: "B", id: "u2" }))).status).toBe(201);
    expect((await a("POST", "/api/units", unit("p2", "12", { id: "u3" }))).status).toBe(201);
    // Güncellemede de korunur: no değişimi ve proje taşıma.
    expect((await a("PATCH", "/api/units/u2", { block: "A" })).status).toBe(409);
    expect((await a("PATCH", "/api/units/u3", { projectId: "p1" })).status).toBe(409);
    expect((await a("PATCH", "/api/units/u3", { projectId: "yok" })).status).toBe(400);
    expect((await a("PATCH", "/api/units/u1", { status: "opsiyonlu" })).status).toBe(200);
    // Eşzamanlı iki istekten yalnız biri oluşturur.
    const race = await Promise.all([a("POST", "/api/units", unit("p1", "77")), a("POST", "/api/units", unit("p1", "77"))]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const { units } = await (await a("GET", "/api/projects")).json();
    expect(units.filter((u: any) => u.projectId === "p1")).toHaveLength(3);
  });

  it("alanlar doğrulanır; kimlik ve tarih alanları istekle değiştirilemez; arşivleme kaydı korur", async () => {
    const a = await single();
    for (const bad of [{ listPrice: -1 }, { currency: "GBP" }, { status: "kiralık" }, { floor: 2.5 }, { unitNo: "" }, { grossM2: -5 }, { floorPlanImageUrl: "javascript:alert(1)" }])
      expect([JSON.stringify(bad), (await a("POST", "/api/units", unit("p1", "5", bad))).status]).toEqual([JSON.stringify(bad), 400]);
    expect((await a("POST", "/api/projects", { name: "" })).status).toBe(400);
    expect((await a("POST", "/api/projects", project("Durum", { status: "iptal" }))).status).toBe(400);
    expect((await a("POST", "/api/projects", project("Tarih", { deliveryDate: "31.12.2027" }))).status).toBe(400);
    expect((await a("POST", "/api/projects", project("Aynı kimlik", { id: "p1" }))).status).toBe(409);
    expect((await a("POST", "/api/projects", project("Kötü kimlik", { id: "../x" }))).status).toBe(400);

    const created = await (await a("POST", "/api/units", unit("p1", "5", { id: "u5" }))).json();
    const patched = await (await a("PATCH", "/api/units/u5", { id: "başka", createdAt: "2000-01-01T00:00:00.000Z", listPrice: 5_000_000, features: ["Balkon", "Otopark"] })).json();
    expect(patched).toMatchObject({ id: "u5", createdAt: created.createdAt, listPrice: 5_000_000, features: ["Balkon", "Otopark"] });
    expect((await a("PATCH", "/api/units/yok", { listPrice: 1 })).status).toBe(404);

    const archived = await (await a("PATCH", "/api/projects/p1", { archived: true, deliveryDate: "2027-12-31", amenities: ["Havuz"] })).json();
    expect(archived).toMatchObject({ archived: true, deliveryDate: "2027-12-31", amenities: ["Havuz"], name: "Örnek Vadi Konutları" });
    const { projects, units } = await (await a("GET", "/api/projects")).json();
    expect(projects.find((p: any) => p.id === "p1").archived).toBe(true);
    expect(units.map((u: any) => u.id)).toContain("u5");
    // Silme ucu yoktur.
    expect((await a("DELETE", "/api/units/u5")).status).toBe(404);
    expect((await a("DELETE", "/api/projects/p1")).status).toBe(404);
  });

  it("toplu içe aktarma: yeni daireler eklenir, aynı blok + no seçime göre güncellenir veya atlanır", async () => {
    const a = await single();
    expect((await a("POST", "/api/units", unit("p1", "1", { id: "u1", status: "satıldı", notes: "elle girildi", currency: "USD", listPrice: 100_000 }))).status).toBe(201);
    const rows = [
      { block: "A", unitNo: "1", listPrice: 120_000 },
      { block: "A", unitNo: "2", floor: 1, listPrice: 3_000_000, type: "1+1", grossM2: 70, status: "opsiyonlu" },
      { block: "A", unitNo: "3", listPrice: 3_100_000 },
      { block: "A", unitNo: "4", floor: 2, listPrice: 3_200_000, bilinmeyen: "x" },
      { block: "A", unitNo: "5", floor: 2, listPrice: -4 },
    ];
    const skipped = await (await a("POST", "/api/units/import", { projectId: "p1", duplicates: "skip", rows })).json();
    expect(skipped).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    expect(skipped.errors.map((e: any) => e.index)).toEqual([2, 3, 4]);
    let units = (await (await a("GET", "/api/projects")).json()).units;
    expect(units.find((u: any) => u.id === "u1")).toMatchObject({ listPrice: 100_000, status: "satıldı" });
    expect(units.find((u: any) => u.unitNo === "2")).toMatchObject({ projectId: "p1", floor: 1, type: "1+1", status: "opsiyonlu", currency: "TRY", netM2: 0 });

    const updated = await (await a("POST", "/api/units/import", { projectId: "p1", duplicates: "update", rows: rows.slice(0, 2) })).json();
    expect(updated).toMatchObject({ created: 0, updated: 2, skipped: 0, errors: [] });
    units = (await (await a("GET", "/api/projects")).json()).units;
    // Dosyada olmayan alanlar (durum, para birimi, not) eski değerini korur.
    expect(units.find((u: any) => u.id === "u1")).toMatchObject({ listPrice: 120_000, status: "satıldı", currency: "USD", notes: "elle girildi", floor: 3 });
    expect(units).toHaveLength(2);

    // Aynı istekte yinelenen satır ikinci kez oluşturulmaz.
    const twice = await (await a("POST", "/api/units/import", { projectId: "p1", duplicates: "skip", rows: [{ unitNo: "9", floor: 1, listPrice: 1 }, { unitNo: "9", floor: 1, listPrice: 2 }] })).json();
    expect(twice).toMatchObject({ created: 1, skipped: 1 });
    expect((await a("POST", "/api/units/import", { projectId: "p1", duplicates: "sil", rows })).status).toBe(400);
    expect((await a("POST", "/api/units/import", { projectId: "p1", duplicates: "skip", rows: [] })).status).toBe(400);
    expect((await a("POST", "/api/units/import", { projectId: "p1", duplicates: "skip", rows: Array.from({ length: 1001 }, (_, i) => ({ unitNo: String(i) })) })).status).toBe(400);
  });
});

describe("Proje ve daire envanteri — çalışan yetkileri", () => {
  async function withEmployee(grant: { read: boolean; write: boolean }) {
    delete process.env.XRE_SESSION_SECRET;
    process.env.MANUS_PROJECT_ID = "projects-rbac-test";
    process.env.MANUS_JWT_SECRET = "test-only-projects-secret";
    const store = createMemoryStore();
    await store.claimOwner({ openId: "o", name: "Sahip" });
    await store.put("employee", "e", { id: "e", openId: "m", name: "Satış Danışmanı", active: true, roleId: "sales", departmentId: "d", title: "", phone: "", email: "" }, "o");
    const role = defaultRole("sales")!;
    role.grants.crm = { ...role.grants.crm, ...grant, scope: "own" };
    await store.put("role", "sales", role, "o");
    const ctx = await listen(store);
    const ownerCookie = `webdev_app_session=${await createSessionToken({ openId: "o", name: "Sahip" })}`;
    const memberCookie = `webdev_app_session=${await createSessionToken({ openId: "m", name: "Satış Danışmanı" })}`;
    const owner = ctx.make(ownerCookie);
    expect((await owner("POST", "/api/projects", project("Örnek Vadi Konutları", { id: "p1" }))).status).toBe(201);
    expect((await owner("POST", "/api/units", unit("p1", "1", { id: "u1" }))).status).toBe(201);
    const image = await (await ctx.upload(ownerCookie, png())).json();
    return { ...ctx, owner, member: ctx.make(memberCookie), memberCookie, image };
  }

  it("crm okuma yetkisi olan çalışan envanterin tamamını görür ama yazamaz", async () => {
    const { member, memberCookie, upload, image, owner } = await withEmployee({ read: true, write: false });
    const list = await member("GET", "/api/projects");
    expect(list.status).toBe(200);
    const body = await list.json();
    // Kapsam "yalnız kendi kayıtları" olsa da envanter firmaya aittir.
    expect(body.projects).toHaveLength(1);
    expect(body.units).toHaveLength(1);
    expect((await member("GET", image.url)).status).toBe(200);
    expect((await member("POST", "/api/projects", project("Yetkisiz"))).status).toBe(403);
    expect((await member("PATCH", "/api/projects/p1", { name: "Yetkisiz" })).status).toBe(403);
    expect((await member("POST", "/api/units", unit("p1", "2"))).status).toBe(403);
    expect((await member("PATCH", "/api/units/u1", { status: "satıldı" })).status).toBe(403);
    expect((await member("POST", "/api/units/import", { projectId: "p1", duplicates: "update", rows: [{ unitNo: "1", listPrice: 1 }] })).status).toBe(403);
    expect((await upload(memberCookie, png())).status).toBe(403);
    const after = await (await owner("GET", "/api/projects")).json();
    expect(after.projects[0].name).toBe("Örnek Vadi Konutları");
    expect(after.units).toHaveLength(1);
    expect(after.units[0]).toMatchObject({ status: "müsait", listPrice: 4_250_000 });
  });

  it("crm yazma yetkisi olan çalışan düzenler; okuma yetkisi olmayan hiçbir şey göremez", async () => {
    const writer = await withEmployee({ read: true, write: true });
    expect((await writer.member("PATCH", "/api/units/u1", { status: "opsiyonlu" })).status).toBe(200);
    expect((await writer.member("POST", "/api/units", unit("p1", "2"))).status).toBe(201);
    expect((await writer.upload(writer.memberCookie, png())).status).toBe(201);

    const none = await withEmployee({ read: false, write: false });
    expect((await none.member("GET", "/api/projects")).status).toBe(403);
    expect((await none.member("GET", none.image.url)).status).toBe(403);
    expect((await none.member("PATCH", "/api/units/u1", { status: "satıldı" })).status).toBe(403);
  });
});

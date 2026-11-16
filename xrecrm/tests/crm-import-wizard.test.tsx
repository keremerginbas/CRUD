// @vitest-environment jsdom
import React from "react";
import { it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { StoreProvider } from "../client/src/workspace/store";
import ImportWizard from "../client/src/workspace/components/ImportWizard";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function csvFile(lines: string[], name = "kisiler.csv") {
  const text = lines.join("\n");
  const file = new File([text], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}

it("canlı modda dosyayı 500'lük parçalarla önizler ve aktarır; yarıda kalan parça aynı kimlikle yeniden denenir", async () => {
  const previews: any[] = [];
  const commits: any[] = [];
  let failNextCommit = false;
  const json = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/me")
        return json({ user: { openId: "u-test", name: "Test", canAccess: true } });
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url === "/api/crm-import/preview") {
        previews.push(body);
        return json({
          kind: body.kind,
          rows: body.rows.map((raw: any, i: number) => ({
            rowNumber: i + 2,
            raw,
            status: raw.email === "bozuk" ? "error" : "ready",
            issues:
              raw.email === "bozuk"
                ? [{ code: "INVALID_EMAIL", message: "Geçerli bir e-posta adresi gerekli." }]
                : [],
          })),
        });
      }
      if (url === "/api/crm-import/commit") {
        commits.push(body);
        if (failNextCommit) {
          failNextCommit = false;
          return json({ message: "Sunucuya ulaşılamadı." }, false, 503);
        }
        if (commits.length === 1) failNextCommit = true;
        return json({
          rows: body.rows.map((raw: any, i: number) =>
            raw.email === "bozuk"
              ? {
                  rowNumber: i + 2,
                  raw,
                  status: "error",
                  issues: [{ code: "INVALID_EMAIL", message: "Geçerli bir e-posta adresi gerekli." }],
                }
              : { rowNumber: i + 2, raw, status: "ready", issues: [], created: true },
          ),
        });
      }
      return json({});
    }),
  );
  render(
    <StoreProvider>
      <ImportWizard kind="contacts" onClose={() => {}} />
    </StoreProvider>,
  );
  await waitFor(() =>
    expect(
      (fetch as any).mock.calls.some((call: any[]) => call[0] === "/api/state"),
    ).toBe(true),
  );
  expect(screen.getByText(/en fazla 50\.000 satır/)).toBeTruthy();

  const lines = ["Ad;E-posta"];
  for (let i = 1; i <= 1_200; i++) lines.push(`Kişi ${i};kisi${i}@example.test`);
  lines[1_101] = "Hatalı;bozuk"; // dosyada 1.102. satır → 3. parça
  lines[900] = "Tekrar;KISI7@example.test"; // dosyada 901. satır = 8. satırın mükerreri
  fireEvent.change(screen.getByLabelText("CSV dosyası seç"), {
    target: { files: [csvFile(lines)] },
  });
  await screen.findByText(/1\.200 veri satırı/);
  fireEvent.click(screen.getByRole("button", { name: "Önizlemeyi oluştur" }));
  const commitButton = await screen.findByRole("button", {
    name: "1.198 yeni kaydı içe aktar",
  });
  // Önizleme: 3 istek, her biri ≤ 500 satır; dosya-içi mükerrer sunucuya gönderilmedi.
  expect(previews.map((p) => p.rows.length)).toEqual([500, 500, 199]);
  expect(previews.flatMap((p) => p.rows).some((r: any) => r.name === "Tekrar")).toBe(false);
  expect(screen.getByLabelText("Önizleme özeti").textContent).toMatch(
    /1\.200 satır.*1\.198 hazır.*1 mükerrer.*1 hatalı/,
  );
  // Tabloda yalnızca ilk 200 satır + hatalı satır; satır numarası dosyaya göre.
  const bodyRows = document.querySelectorAll(".dq-import-table tbody tr");
  expect(bodyRows).toHaveLength(201);
  expect(bodyRows[200].textContent).toMatch(/^1102Hatalı/);

  fireEvent.click(commitButton);
  await screen.findByText("Aktarım yarıda kaldı");
  // 500 satırlık ilk parça + sunucuya gönderilmeyen 1 dosya-içi mükerrer.
  expect(screen.getByText(/501 \/ 1\.200 satır işlendi/)).toBeTruthy();
  expect(
    screen.getByText(/500 yeni kayıt · 0 daha önce eklenmiş kayıt · 1 mükerrer · 0 hatalı satır/),
  ).toBeTruthy();
  expect(screen.getByText("Sunucuya ulaşılamadı.")).toBeTruthy();
  expect(commits).toHaveLength(2);

  fireEvent.click(
    screen.getByRole("button", { name: "Kaldığı yerden yeniden dene" }),
  );
  await screen.findByText("Aktarım sonucu");
  expect(
    screen.getByText(/1\.198 yeni kayıt · 0 daha önce eklenmiş kayıt · 1 mükerrer · 1 hatalı satır/),
  ).toBeTruthy();
  expect(screen.getByText(/Satır 1102: Geçerli bir e-posta adresi gerekli\./)).toBeTruthy();
  // 1. parça bir kez; 2. parça aynı operationId ile iki kez; 3. parça bir kez.
  expect(commits.map((c) => c.rows.length)).toEqual([500, 500, 500, 199]);
  const ids = commits.map((c) => c.operationId);
  expect(ids[1]).toBe(ids[2]);
  expect(new Set(ids).size).toBe(3);
  expect(commits[1]).toEqual(commits[2]);
}, 30_000);

it("demo modunda büyük dosya yerelde parçalanır; durdurulabilir ve kaldığı yerden çiftlemeden sürer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  render(
    <StoreProvider>
      <ImportWizard kind="companies" onClose={() => {}} />
    </StoreProvider>,
  );
  const lines = ["Şirket Adı;Telefon"];
  for (let i = 1; i <= 1_300; i++) lines.push(`Örnek Şirket ${i};`);
  lines[1_250] = "örnek  şirket 3;"; // 1.251. satır = 4. satırın mükerreri
  fireEvent.change(screen.getByLabelText("CSV dosyası seç"), {
    target: { files: [csvFile(lines, "sirketler.csv")] },
  });
  const commitButton = await screen.findByRole(
    "button",
    { name: "1.299 yeni kaydı içe aktar" },
    { timeout: 10_000 },
  );
  expect(screen.getByLabelText("Önizleme özeti").textContent).toMatch(
    /1\.300 satır.*1\.299 hazır.*1 mükerrer.*0 hatalı/,
  );
  fireEvent.click(commitButton);
  fireEvent.click(await screen.findByRole("button", { name: "Durdur" }));
  await screen.findByText("Aktarım durduruldu", {}, { timeout: 10_000 });
  const companies = () =>
    JSON.parse(localStorage.getItem("xre-demo-v2") || "{}").companies.filter(
      (c: any) => String(c.id).startsWith("import_"),
    );
  fireEvent.click(
    screen.getByRole("button", { name: "Kaldığı yerden devam et" }),
  );
  await screen.findByText("Aktarım sonucu", {}, { timeout: 10_000 });
  expect(
    screen.getByText(/1\.299 yeni kayıt · 0 daha önce eklenmiş kayıt · 1 mükerrer · 0 hatalı satır/),
  ).toBeTruthy();
  await waitFor(() => expect(companies()).toHaveLength(1_299));
  expect(new Set(companies().map((c: any) => c.name)).size).toBe(1_299);
}, 60_000);

it("ilk adımda şablon düğmesi ve beklenen başlıklar görünür; fazla sütunlu dosya tek cümleyle bildirilir", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  render(
    <StoreProvider>
      <ImportWizard kind="leads" onClose={() => {}} />
    </StoreProvider>,
  );
  expect(screen.getByRole("button", { name: "Örnek şablonu indir" })).toBeTruthy();
  expect(
    screen.getByText("Ad Soyad, Telefon, E-posta, Şehir, Ülke, Proje, Kaynak, Not"),
  ).toBeTruthy();
  const extra = Array.from({ length: 52 }, (_, i) => `Özel Alan ${i + 1}`);
  fireEvent.change(screen.getByLabelText("CSV dosyası seç"), {
    target: {
      files: [
        csvFile(
          [
            [...extra, "Ad Soyad", "Telefon", "Ülke", "Proje"].join(";"),
            [...extra.map(() => "x"), "Ayşe Yılmaz", "05550000001", "Türkiye", "Örnek Proje"].join(";"),
          ],
          "genis.csv",
        ),
      ],
    },
  });
  expect(await screen.findByText("Tanınmayan 24 sütun dışarıda bırakıldı.")).toBeTruthy();
  // Kullanıcı dosyanın eşleştiğini görür: tanınan sütunlar adıyla yazılır ve listede en üstte durur.
  expect(screen.getByText("Ad Soyad, Telefon, Ülke, Proje")).toBeTruthy();
  const selects = Array.from(
    document.querySelectorAll<HTMLSelectElement>(".dq-column-mapping select"),
  );
  expect(selects).toHaveLength(32);
  expect(selects.slice(0, 5).map((select) => select.value)).toEqual(["name", "phone", "country", "project", ""]);
  expect(selects[4].getAttribute("aria-label")).toBe("Özel Alan 1 sütun eşlemesi");
  // Dışarıda kalan sütunlar adıyla sayılır ve ne yapılacağı söylenir.
  const dropped = document.querySelector(".dq-import-dropped")!.textContent!;
  expect(dropped).toContain("Dışarıda kalanlar: Özel Alan 29, Özel Alan 30");
  expect(dropped).toContain("ve 16 sütun daha");
  expect(dropped).toContain("yeniden yükleyin");
  expect((screen.getByLabelText("Ülke sütun eşlemesi") as HTMLSelectElement).value).toBe("country");
  expect((screen.getByLabelText("Proje sütun eşlemesi") as HTMLSelectElement).value).toBe("project");
  expect(screen.queryByLabelText("Özel Alan 40 sütun eşlemesi")).toBeNull();
  await screen.findByRole("button", { name: "1 yeni kaydı içe aktar" });
});

it("şablondaki örnek satır silinmeden yüklenirse aktarılmaz; yalnızca kullanıcının satırı eklenir", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  render(
    <StoreProvider>
      <ImportWizard kind="leads" onClose={() => {}} />
    </StoreProvider>,
  );
  const header = "Ad Soyad;Telefon;E-posta;Şehir;Ülke;Proje;Kaynak;Not";
  const example =
    "Ayşe Yılmaz;05550000001;ornek@example.com;İstanbul;Türkiye;Örnek Proje;Web sitesi;Bu örnek satırı silip kendi müşterilerinizi yazın.";
  const input = screen.getByLabelText("CSV dosyası seç");
  fireEvent.change(input, { target: { files: [csvFile([header, example], "sablon.csv")] } });
  expect(await screen.findByText(/Şablondaki örnek satır aktarılmaz\. Dosyada başka satır yok/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /yeni kaydı içe aktar/ })).toBeNull();
  fireEvent.change(input, {
    target: {
      files: [
        csvFile([header, example, "Mehmet Örnek;05550000002;;İzmir;Türkiye;;Fuar;"], "sablon-dolu.csv"),
      ],
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "1 yeni kaydı içe aktar" }));
  await screen.findByText("Aktarım sonucu");
  const leads = JSON.parse(localStorage.getItem("xre-demo-v2")!).leads.map((lead: any) => lead.name);
  expect(leads).toContain("Mehmet Örnek");
  expect(leads).not.toContain("Ayşe Yılmaz");
});

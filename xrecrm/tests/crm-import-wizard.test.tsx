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

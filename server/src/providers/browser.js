// Gerçek siteleri başsız (headless) Chromium ile açar ve sayfanın yaptığı JSON
// isteklerinin yanıtlarını toplar. Playwright isteğe bağlı bir bağımlılıktır:
// sadece gerçek site modunda (PROVIDERS=live) yüklenir.

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      let playwright;
      try {
        playwright = await import('playwright');
      } catch {
        throw new Error('Playwright kurulu değil. server klasöründe "npm install playwright && npx playwright install chromium" çalıştırın.');
      }
      return playwright.chromium.launch({
        headless: process.env.HEADLESS !== '0',
        executablePath: process.env.CHROMIUM_PATH || undefined,
      });
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function captureJson(url, { timeoutMs = 45000, settleMs = 6000, maxBodyBytes = 5_000_000 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const responses = [];
  const pending = [];

  page.on('response', (response) => {
    const type = response.headers()['content-type'] || '';
    if (!type.includes('json')) return;
    pending.push(
      response
        .text()
        .then((text) => {
          if (text.length > maxBodyBytes) return;
          responses.push({ url: response.url(), status: response.status(), body: JSON.parse(text) });
        })
        .catch(() => {}),
    );
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Sonuçlar genelde sayfa açıldıktan sonra parça parça gelir.
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
    await page.waitForTimeout(settleMs);
    await Promise.all(pending);
    const title = await page.title().catch(() => '');
    return { responses, title, finalUrl: page.url() };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close();
}

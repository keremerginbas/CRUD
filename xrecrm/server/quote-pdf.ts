// Teklif PDF'i (pdfkit). Türkçe karakterler için DejaVu Sans gömülür (public/fonts; lisans aynı klasörde).
// Belgede yalnız müşteriye verilebilecek bilgiler yer alır: NBD, para maliyeti ve prim ASLA yazılmaz.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { Project } from "../shared/real-estate.js";
import { formatDay, formatMoneyCode, formatPct, unitLabelOf, type Quote, type QuoteSettings } from "../shared/quotes.js";

export const PDF_WATERMARK = "ONAYLANMADI – MÜŞTERİYE VERİLEMEZ";

export interface QuotePdfInput {
  quote: Quote;
  settings: Pick<QuoteSettings, "companyName" | "companyAddress" | "companyPhone">;
  project?: Pick<Project, "name" | "city" | "district" | "address" | "deliveryDate"> | null;
  /** Onaylanmamış teklifin iç önizlemesi: her sayfaya filigran basılır. */
  watermark?: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));
let fontCache: { regular: Buffer; bold: Buffer } | null = null;
/** Yazı tipleri geliştirmede public/fonts, derlenmiş kurulumda dist/public/fonts altındadır. */
function fonts(): { regular: Buffer; bold: Buffer } {
  if (fontCache) return fontCache;
  const dirs = [
    process.env.XRE_FONT_DIR?.trim() || "",
    path.join(here, "public", "fonts"),
    path.join(here, "..", "public", "fonts"),
    path.join(process.cwd(), "public", "fonts"),
    path.join(process.cwd(), "dist", "public", "fonts"),
  ].filter(Boolean);
  for (const dir of dirs) {
    try {
      fontCache = { regular: fs.readFileSync(path.join(dir, "DejaVuSans.ttf")), bold: fs.readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")) };
      return fontCache;
    } catch {
      /* sonraki klasör */
    }
  }
  throw new Error("Teklif PDF yazı tipi (DejaVuSans.ttf) bulunamadı.");
}

const floorText = (floor: number) => (floor === 0 ? "Zemin kat" : floor < 0 ? `${-floor}. bodrum` : `${floor}. kat`);
const m2 = (value: number) => (value > 0 ? `${String(Math.round(value * 10) / 10).replace(".", ",")} m²` : "—");
const KIND_LABEL: Record<string, string> = { peşinat: "Peşinat", taksit: "Taksit", "ara ödeme": "Ara ödeme" };

/** Belgenin metin içeriği: çizimden bağımsızdır, testte ve çizimde aynı kaynak kullanılır. */
export function quotePdfContent({ quote, settings, project }: QuotePdfInput) {
  const { plan, inputs } = quote;
  const money = (value: number) => formatMoneyCode(value, inputs.currency);
  const discount = quote.listPrice - plan.salePrice;
  const balloonTotal = plan.rows.filter((r) => r.kind === "ara ödeme").reduce((sum, r) => sum + r.amount, 0);
  const location = [project?.district, project?.city].filter(Boolean).join(", ");
  const summary: [string, string, boolean][] = [];
  if (discount > 0.005) {
    summary.push(["Liste fiyatı", money(quote.listPrice), false]);
    summary.push(["İskonto", `${formatPct(quote.evaluation.discountPct)} · ${money(discount)}`, false]);
  }
  summary.push(["Satış bedeli", money(plan.salePrice), true]);
  summary.push(["Peşinat", money(plan.downPayment), false]);
  if (plan.months > 0) {
    summary.push(["Vadeye kalan tutar", money(plan.financed), false]);
    summary.push([`Vade farkı (${plan.months} ay)`, money(plan.vadeFarki), false]);
    summary.push(["Aylık taksit", `${plan.months} × ${money(plan.installment)}`, false]);
    if (balloonTotal > 0) summary.push(["Ara ödemeler toplamı", money(Math.round(balloonTotal * 100) / 100), false]);
  }
  summary.push(["Toplam ödeme (ödeme bedeli)", money(plan.totalPayable), true]);
  return {
    title: "SATIŞ TEKLİFİ",
    company: { name: settings.companyName || "", address: settings.companyAddress || "", phone: settings.companyPhone || "" },
    meta: [
      ["Teklif no", quote.quoteNo],
      ["Tarih", formatDay(quote.decision?.status === "onaylandı" ? quote.decision.at : quote.createdAt)],
      ["Geçerlilik", formatDay(quote.validUntil)],
    ] as [string, string][],
    customer: [
      ["Ad soyad", quote.customer.name || "—"],
      ["Telefon", quote.customer.phone || "—"],
    ] as [string, string][],
    property: [
      ["Proje", quote.unit.projectName || project?.name || "—"],
      ...(location ? [["Konum", location] as [string, string]] : []),
      ["Bağımsız bölüm", unitLabelOf(quote.unit)],
      ["Tip / kat", `${quote.unit.type || "—"} · ${floorText(quote.unit.floor)}`],
      ["Brüt / net", `${m2(quote.unit.grossM2)} / ${m2(quote.unit.netM2)}`],
      ...(project?.deliveryDate ? [["Teslim", formatDay(project.deliveryDate)] as [string, string]] : []),
    ] as [string, string][],
    summary,
    rows: plan.rows.map((row) => ({ no: String(row.no), date: formatDay(row.dueDate), kind: KIND_LABEL[row.kind] || row.kind, amount: money(row.amount) })),
    total: money(plan.totalPayable),
    validity: `Bu teklif ${formatDay(quote.validUntil)} tarihine kadar geçerlidir.`,
    signatures: [
      ["Müşteri", quote.customer.name],
      ["Satış danışmanı", quote.employee.name],
      ["Yetkili onayı", quote.decision?.status === "onaylandı" ? quote.decision.byName : ""],
    ] as [string, string][],
  };
}

const INK = "#1b2733";
const SOFT = "#5c6b7a";
const LINE = "#c9d2db";
const BAND = "#eef2f6";

export function buildQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  const content = quotePdfContent(input);
  const { regular, bold } = fonts();
  return new Promise<Buffer>((resolve, reject) => {
    const margin = 42;
    const doc = new PDFDocument({
      size: "A4",
      margin,
      bufferPages: true,
      info: { Title: `Satış Teklifi ${input.quote.quoteNo}`, Author: content.company.name || "XRE CRM", Subject: content.title },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("r", regular);
    doc.registerFont("b", bold);

    const width = doc.page.width - margin * 2;
    const bottom = doc.page.height - margin - 26; // alt bilgi için pay
    let y = margin + (input.watermark ? 22 : 0);
    const text = (value: string, x: number, top: number, options: PDFKit.Mixins.TextOptions & { font?: "r" | "b"; size?: number; color?: string } = {}) => {
      const { font = "r", size = 9, color = INK, ...rest } = options;
      doc.font(font).fontSize(size).fillColor(color).text(value, x, top, { lineBreak: false, ...rest });
    };
    const rule = (top: number, color = LINE) => doc.moveTo(margin, top).lineTo(margin + width, top).lineWidth(0.7).strokeColor(color).stroke();
    const newPage = () => {
      doc.addPage();
      y = margin + (input.watermark ? 22 : 0);
    };

    // Başlık: solda firma, sağda belge bilgisi
    const metaX = margin + width - 190;
    text(content.company.name || "Satış Ofisi", margin, y, { font: "b", size: 15, width: width - 200, lineBreak: true });
    let leftY = doc.y + 3;
    for (const line of [content.company.address, content.company.phone && `Tel: ${content.company.phone}`].filter(Boolean) as string[]) {
      text(line, margin, leftY, { size: 8.5, color: SOFT, width: width - 210, lineBreak: true });
      leftY = doc.y + 1;
    }
    text(content.title, metaX, y, { font: "b", size: 13, width: 190, align: "right" });
    let rightY = y + 20;
    for (const [label, value] of content.meta) {
      text(`${label}:`, metaX, rightY, { size: 8.5, color: SOFT, width: 90, align: "right" });
      text(value, metaX + 96, rightY, { font: "b", size: 8.5, width: 94, align: "right" });
      rightY += 13;
    }
    y = Math.max(leftY, rightY) + 8;
    rule(y, INK);
    y += 12;

    // Müşteri ve gayrimenkul kutuları
    const half = (width - 14) / 2;
    const box = (title: string, rows: [string, string][], x: number, top: number) => {
      text(title, x, top, { font: "b", size: 8, color: SOFT, characterSpacing: 0.6 });
      let rowY = top + 14;
      for (const [label, value] of rows) {
        text(label, x, rowY, { size: 8.5, color: SOFT, width: 78 });
        text(value, x + 82, rowY, { size: 9, width: half - 82, lineBreak: true });
        rowY = Math.max(rowY + 13, doc.y + 2);
      }
      return rowY;
    };
    const endLeft = box("MÜŞTERİ", content.customer, margin, y);
    const endRight = box("GAYRİMENKUL", content.property, margin + half + 14, y);
    y = Math.max(endLeft, endRight) + 8;
    rule(y);
    y += 12;

    // Fiyat özeti
    text("FİYAT ÖZETİ", margin, y, { font: "b", size: 8, color: SOFT, characterSpacing: 0.6 });
    y += 14;
    for (const [label, value, strong] of content.summary) {
      if (strong) doc.rect(margin, y - 3, width, 16).fill(BAND);
      text(label, margin + 6, y, { font: strong ? "b" : "r", size: 9.5 });
      text(value, margin + width - 266, y, { font: strong ? "b" : "r", size: 9.5, width: 260, align: "right" });
      y += 16;
    }
    y += 10;

    // Ödeme planı: uzun planlarda iki sütun
    const rowH = 12.5;
    const headH = 16;
    const blocks = content.rows.length > 18 ? 2 : 1;
    const gap = 16;
    const blockW = (width - gap * (blocks - 1)) / blocks;
    const cols = { no: 24, date: 68, kind: blockW - 24 - 68 - 104, amount: 104 };
    const drawHead = (x: number, top: number) => {
      doc.rect(x, top, blockW, headH).fill(BAND);
      text("No", x + 4, top + 4.5, { font: "b", size: 7.5, color: SOFT, width: cols.no - 4 });
      text("Vade tarihi", x + cols.no, top + 4.5, { font: "b", size: 7.5, color: SOFT });
      text("Açıklama", x + cols.no + cols.date, top + 4.5, { font: "b", size: 7.5, color: SOFT });
      text("Tutar", x + cols.no + cols.date + cols.kind, top + 4.5, { font: "b", size: 7.5, color: SOFT, width: cols.amount - 4, align: "right" });
    };
    let index = 0;
    let first = true;
    while (index < content.rows.length) {
      const titleH = 14;
      let capacity = Math.floor((bottom - y - titleH - headH) / rowH);
      if (capacity < 4) {
        newPage();
        capacity = Math.floor((bottom - y - titleH - headH) / rowH);
      }
      text(first ? "ÖDEME PLANI" : "ÖDEME PLANI (devam)", margin, y, { font: "b", size: 8, color: SOFT, characterSpacing: 0.6 });
      y += titleH;
      const remaining = content.rows.length - index;
      const perBlock = Math.min(capacity, Math.ceil(remaining / blocks));
      for (let block = 0; block < blocks && index < content.rows.length; block++) {
        const x = margin + block * (blockW + gap);
        drawHead(x, y);
        for (let i = 0; i < perBlock && index < content.rows.length; i++, index++) {
          const row = content.rows[index];
          const top = y + headH + i * rowH;
          const strong = row.kind !== "Taksit";
          text(row.no, x + 4, top + 3, { size: 8, color: SOFT, width: cols.no - 4 });
          text(row.date, x + cols.no, top + 3, { size: 8 });
          text(row.kind, x + cols.no + cols.date, top + 3, { size: 8, font: strong ? "b" : "r" });
          text(row.amount, x + cols.no + cols.date + cols.kind, top + 3, { size: 8, font: strong ? "b" : "r", width: cols.amount - 4, align: "right" });
          doc.moveTo(x, top + rowH).lineTo(x + blockW, top + rowH).lineWidth(0.3).strokeColor(LINE).stroke();
        }
      }
      y += headH + perBlock * rowH + 8;
      first = false;
      if (index < content.rows.length) newPage();
    }

    // Toplam, geçerlilik ve imzalar
    if (y + 120 > bottom) newPage();
    doc.rect(margin, y, width, 20).fill(BAND);
    text("Toplam ödeme", margin + 6, y + 5.5, { font: "b", size: 10 });
    text(content.total, margin + width - 266, y + 5.5, { font: "b", size: 10, width: 260, align: "right" });
    y += 32;
    text(content.validity, margin, y, { size: 9, width, lineBreak: true });
    y = doc.y + 44;
    const sigW = (width - 40) / 3;
    content.signatures.forEach(([label, name], i) => {
      const x = margin + i * (sigW + 20);
      doc.moveTo(x, y).lineTo(x + sigW, y).lineWidth(0.7).strokeColor(INK).stroke();
      text(label, x, y + 5, { font: "b", size: 8.5, width: sigW, align: "center" });
      if (name) text(name, x, y + 17, { size: 8.5, color: SOFT, width: sigW, align: "center" });
    });

    // Her sayfaya alt bilgi ve (önizlemede) filigran
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;
      const footY = doc.page.height - margin - 6;
      rule(footY - 6);
      text([input.quote.quoteNo, content.company.name].filter(Boolean).join(" · "), margin, footY, { size: 7.5, color: SOFT });
      text(`Sayfa ${i + 1} / ${range.count}`, margin, footY, { size: 7.5, color: SOFT, width, align: "right" });
      if (input.watermark) {
        doc.rect(margin, margin - 8, width, 18).fill("#b3261e");
        text(PDF_WATERMARK, margin, margin - 3, { font: "b", size: 9, color: "#ffffff", width, align: "center" });
        doc.save();
        doc.rotate(-38, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.opacity(0.16);
        text(PDF_WATERMARK, doc.page.width / 2 - 500, doc.page.height / 2 - 20, { font: "b", size: 25, color: "#b3261e", width: 1000, align: "center" });
        doc.restore();
      }
    }
    doc.end();
  });
}

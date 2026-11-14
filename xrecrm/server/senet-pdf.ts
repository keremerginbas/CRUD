// Senet (bono) çıktısı: A4 sayfaya üç senet. Türkçe karakterler için teklif PDF'iyle aynı yazı tipi kullanılır.
import PDFDocument from "pdfkit";
import { fonts } from "./quote-pdf.js";
import { formatDay, formatMoneyCode, type Quote } from "../shared/quotes.js";
import { amountInWords, type Sale } from "../shared/senet.js";

export interface SenetPdfInput {
  quote: Pick<Quote, "quoteNo" | "unit">;
  sale: Pick<Sale, "parties" | "senets">;
  companyName: string;
}

/** Bir senedin metin içeriği: çizimden bağımsızdır, testte ve çizimde aynı kaynak kullanılır. */
export function senetText(input: SenetPdfInput, index: number) {
  const senet = input.sale.senets[index];
  const p = input.sale.parties;
  const creditor = input.companyName || "alacaklı";
  const place = p.issuePlace || "";
  return {
    no: `${senet.no}/${senet.of}`,
    due: formatDay(senet.dueDate),
    amount: formatMoneyCode(senet.amount, senet.currency),
    body:
      `İşbu emre muharrer senedim mukabilinde ${formatDay(senet.dueDate)} tarihinde Sayın ${creditor} veya emruhavalesine ` +
      `yukarıda yazılı ${amountInWords(senet.amount, senet.currency)} ödeyeceğim. Bedeli malen ahzolunmuştur. ` +
      `İşbu senet vadesinde ödenmediği takdirde müteakip senetlerin de muacceliyet kesbedeceğini, ihtilaf vukuunda ` +
      `${place ? `${place} ` : ""}mahkemelerinin ve icra dairelerinin yetkisini şimdiden kabul eylerim.`,
    issued: [place, formatDay(p.contractDate)].filter(Boolean).join(", "),
    debtor: [p.buyerName, p.buyerTckn && `T.C. Kimlik No: ${p.buyerTckn}`, p.buyerAddress].filter(Boolean) as string[],
    guarantor: [p.guarantorName, p.guarantorTckn && `T.C. Kimlik No: ${p.guarantorTckn}`, p.guarantorAddress].filter(Boolean) as string[],
    ref: [input.quote.quoteNo, input.quote.unit.projectName, input.quote.unit.block && `${input.quote.unit.block} Blok`, `No ${input.quote.unit.unitNo}`].filter(Boolean).join(" · "),
  };
}

export function buildSenetPdf(input: SenetPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const f = fonts();
    const doc = new PDFDocument({ size: "A4", margin: 28, info: { Title: `Senetler ${input.quote.quoteNo}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("r", f.regular);
    doc.registerFont("b", f.bold);
    const INK = "#111827";
    const SOFT = "#6b7280";
    const margin = 28;
    const width = doc.page.width - margin * 2;
    const slotH = (doc.page.height - margin * 2) / 3;
    const text = (value: string, x: number, y: number, o: { font?: "r" | "b"; size?: number; color?: string; width?: number; align?: "left" | "right" | "center" | "justify" } = {}) =>
      doc.font(o.font || "r").fontSize(o.size || 9).fillColor(o.color || INK).text(value, x, y, { width: o.width, align: o.align, lineGap: 1.5 });

    input.sale.senets.forEach((_, index) => {
      if (index > 0 && index % 3 === 0) doc.addPage();
      const t = senetText(input, index);
      const top = margin + (index % 3) * slotH;
      const x = margin;
      const h = slotH - 10;
      doc.rect(x, top, width, h).lineWidth(0.8).strokeColor(INK).stroke();
      // Başlık şeridi
      doc.rect(x, top, width, 26).fill("#eef2f7");
      text("SENET", x + 10, top + 7, { font: "b", size: 12 });
      text(`No: ${t.no}`, x + 90, top + 9, { size: 9 });
      text(`Vade: ${t.due}`, x + 180, top + 9, { font: "b", size: 9 });
      text(`Tutar: ${t.amount}`, x + width - 250, top + 8, { font: "b", size: 10.5, width: 240, align: "right" });
      doc.moveTo(x, top + 26).lineTo(x + width, top + 26).lineWidth(0.8).strokeColor(INK).stroke();
      text(t.body, x + 10, top + 36, { size: 9, width: width - 20, align: "justify" });
      const y = top + 104;
      text("Düzenleme yeri ve tarihi", x + 10, y, { size: 7.5, color: SOFT });
      text(t.issued || "—", x + 10, y + 10, { size: 9 });
      const colW = (width - 40) / 3;
      text("BORÇLU", x + 10, y + 30, { font: "b", size: 8 });
      text(t.debtor.join("\n") || "—", x + 10, y + 42, { size: 8.5, width: colW });
      text("KEFİL", x + 20 + colW, y + 30, { font: "b", size: 8 });
      text(t.guarantor.join("\n") || "—", x + 20 + colW, y + 42, { size: 8.5, width: colW });
      text("İMZA", x + 30 + colW * 2, y + 30, { font: "b", size: 8 });
      doc.moveTo(x + 30 + colW * 2, top + h - 30).lineTo(x + width - 10, top + h - 30).lineWidth(0.5).strokeColor(SOFT).stroke();
      text(t.ref, x + 10, top + h - 14, { size: 7, color: SOFT, width: width - 20 });
    });
    doc.end();
  });
}

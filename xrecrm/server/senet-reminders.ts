// Senet hatırlatmaları: vadesi yaklaşan, bugün dolan ve geciken senetler için satış danışmanına ve
// yöneticilere bildirim bırakır. Her senet için her aşamada yalnız bir bildirim oluşur (kimlik sabittir).
import type { Store } from "./db.js";
import { rawStoreOf } from "./access.js";
import { quoteManagerNames } from "./quotes.js";
import { addInboxNotification } from "./triggers.js";
import { WORKSPACE_KIND, WORKSPACE_SYSTEM_OWNER } from "./workspaces.js";
import { QUOTE_KIND, formatDay, formatMoneyCode, unitLabelOf, type Quote } from "../shared/quotes.js";
import { SALE_KIND, type Sale, type Senet } from "../shared/senet.js";

/** Vadeden kaç gün önce "yaklaşıyor" hatırlatması yapılır. */
export const SENET_REMIND_DAYS = 3;

const dayNumber = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : NaN;
};
export const istanbulDay = (date = new Date()) => date.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const istanbulHour = (date = new Date()) => Number(date.toLocaleString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }));

/** Senedin bugünkü hatırlatma aşaması; hatırlatma gerekmiyorsa null. Gecikenler haftada bir yinelenir. */
export function senetStage(senet: Pick<Senet, "dueDate" | "status">, today: string): { key: string; daysLeft: number } | null {
  if (senet.status === "ödendi") return null;
  const daysLeft = dayNumber(senet.dueDate) - dayNumber(today);
  if (!Number.isFinite(daysLeft)) return null;
  if (daysLeft > SENET_REMIND_DAYS) return null;
  if (daysLeft > 0) return { key: "yaklasiyor", daysLeft };
  if (daysLeft === 0) return { key: "bugun", daysLeft };
  return { key: `gecikti-${Math.floor((-daysLeft - 1) / 7)}`, daysLeft };
}

export async function runSenetReminders(store: Store, today = istanbulDay()): Promise<number> {
  const raw = rawStoreOf(store);
  const owners = new Set<string>();
  const main = await raw.resolveOwner().catch(() => undefined);
  if (main) owners.add(main);
  for (const row of await raw.list<{ ownerOpenId?: string; status?: string }>(WORKSPACE_KIND, WORKSPACE_SYSTEM_OWNER).catch(() => []))
    if (row.payload?.ownerOpenId && row.payload.status !== "suspended") owners.add(row.payload.ownerOpenId);

  let created = 0;
  for (const owner of owners) {
    const sales = (await raw.list<Sale>(SALE_KIND, owner)).map((r) => r.payload);
    if (!sales.length) continue;
    const quotes = new Map((await raw.list<Quote>(QUOTE_KIND, owner)).map((r) => [r.payload.id, r.payload]));
    let managers: string[] | null = null;
    for (const sale of sales) {
      const quote = quotes.get(sale.quoteId);
      if (!quote || quote.status === "iptal") continue;
      for (const senet of sale.senets) {
        const stage = senetStage(senet, today);
        if (!stage) continue;
        managers ??= await quoteManagerNames(store, owner).catch(() => []);
        const customer = sale.parties.buyerName || quote.customer.name;
        const amount = formatMoneyCode(senet.amount, senet.currency);
        const title =
          stage.daysLeft > 0
            ? `Senet vadesi ${stage.daysLeft} gün sonra: ${customer} · ${amount}`
            : stage.daysLeft === 0
              ? `Senet vadesi bugün: ${customer} · ${amount}`
              : `Senet ${-stage.daysLeft} gündür gecikmiş: ${customer} · ${amount}`;
        const body = `${quote.quoteNo} · senet ${senet.no}/${senet.of} · vade ${formatDay(senet.dueDate)} · ${quote.unit.projectName} ${unitLabelOf(quote.unit)}`;
        const recipients = new Map<string, string>();
        for (const name of [quote.employee.name, ...managers]) if (name?.trim()) recipients.set(name.trim().toLocaleLowerCase("tr-TR"), name.trim());
        for (const [fold, recipient] of recipients) {
          const id = `senet:${sale.quoteId}:${senet.no}:${stage.key}:${Buffer.from(fold).toString("base64url").slice(0, 40)}`.slice(0, 191);
          const existed = await raw.get("inbox-notification", id, owner);
          if (existed) continue;
          const made = await addInboxNotification(store, owner, { id, recipient, title, body, leadId: quote.leadId }).catch(() => null);
          if (made) created++;
        }
      }
    }
  }
  return created;
}

let timer: NodeJS.Timeout | null = null;
/** Saatte bir denetler; bildirimler yalnız gündüz (08:00–20:00, İstanbul) oluşturulur. */
export function startSenetReminders(store: Store): void {
  if (timer) return;
  const tick = async () => {
    const hour = istanbulHour();
    if (hour < 8 || hour >= 20) return;
    try {
      const count = await runSenetReminders(store);
      if (count) console.log(`Senet hatırlatması: ${count} bildirim oluşturuldu.`);
    } catch (error) {
      console.warn("Senet hatırlatmaları çalışmadı:", error instanceof Error ? error.message : error);
    }
  };
  setTimeout(() => void tick(), 90_000).unref?.();
  timer = setInterval(() => void tick(), 3600_000);
  timer.unref?.();
}

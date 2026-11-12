// E-posta entegrasyonunun istemci tarafı: bağlantı durumu ve müşteri yazışmaları.
// Demo modunda sunucuya hiç istek gitmez; örnek veriler tarayıcı belleğinde tutulur.
import { useCallback, useEffect, useState } from "react";
import { useStore } from "./store";
import type { Lead } from "./data";
import { withBase } from "./nav";
import type { EmailMessage, EmailStatus } from "../../../shared/email";

const DISCONNECTED: EmailStatus = { connected: false, account: null, sync: null };
const DEMO_ACCOUNT: EmailStatus = {
  connected: true,
  account: {
    provider: "gmail",
    address: "siz@ornek-firma.com",
    displayName: "Örnek Kullanıcı",
    username: "siz@ornek-firma.com",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    connectedAt: "2026-01-01T09:00:00.000Z",
  },
  sync: { lastSyncAt: null, lastError: null },
};

// Durum bileşenler arasında paylaşılır (profil kartı + müşteri kartı).
let cached: EmailStatus | null = null;
let cachedFor = "";
let demoStatus: EmailStatus = DEMO_ACCOUNT;
const demoMessages = new Map<string, EmailMessage[]>();
const STATUS_EVENT = "xre:email-status";
const publish = () => window.dispatchEvent(new Event(STATUS_EVENT));

/** Uygulama içi sayfaya geçiş (ör. posta kutusunu bağlama ekranı). */
export function openEmailSettings() {
  window.history.pushState({}, "", withBase("/profile"));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.setTimeout(() => document.getElementById("eposta")?.scrollIntoView({ block: "start" }), 80);
}

export function useEmailStatus() {
  const { demo, request, user } = useStore();
  // Aynı sekmede başka kullanıcı giriş yaparsa önceki kullanıcının durumu gösterilmez.
  const who = String(user?.openId || user?.email || "");
  const [status, setLocal] = useState<EmailStatus | null>(demo ? demoStatus : cachedFor === who ? cached : null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (demo) return setLocal(demoStatus);
    try {
      cached = await request("/api/email/account");
      setError("");
    } catch (e) {
      cached = cached || DISCONNECTED;
      setError((e as Error).message);
    }
    publish();
  }, [demo, request]);
  useEffect(() => {
    const sync = () => setLocal(demo ? demoStatus : cached);
    window.addEventListener(STATUS_EVENT, sync);
    if (cachedFor !== who) {
      cached = null;
      cachedFor = who;
    }
    if (demo) sync();
    else if (!cached) void reload();
    else sync();
    return () => window.removeEventListener(STATUS_EVENT, sync);
  }, [demo, reload, who]);
  /** Sunucudan dönen yeni durumu (veya demo durumunu) tüm bileşenlere duyurur. */
  const setStatus = useCallback(
    (next: EmailStatus) => {
      if (demo) demoStatus = next;
      else cached = next;
      publish();
    },
    [demo],
  );
  return { status, error, reload, setStatus, loading: status === null && !error };
}

/** Demo: e-postası olan müşteri için örnek bir yazışma üretir. */
function demoThread(lead: Lead): EmailMessage[] {
  if (!lead.email) return [];
  const base = Date.parse(lead.lastActivity || lead.createdAt || "") || Date.parse("2026-01-05T09:00:00Z");
  const first = `<demo-1-${lead.id}@ornek-firma.com>`;
  const common = { leadId: lead.id, userOpenId: "demo", truncated: false, references: [] as string[] };
  return [
    {
      ...common,
      id: `demo-out-${lead.id}`,
      direction: "outbound",
      from: DEMO_ACCOUNT.account!.address,
      fromName: DEMO_ACCOUNT.account!.displayName,
      to: lead.email,
      subject: "Görüşmemizin özeti ve teklifimiz",
      text: `Merhaba ${lead.name},\n\nBugünkü görüşmemiz için teşekkür ederiz. Konuştuğumuz seçenekleri ve fiyat teklifimizi aşağıda özetledim.\n\nUygun olduğunuz bir gün yüz yüze de görüşebiliriz.\n\nİyi çalışmalar.`,
      attachments: [],
      messageId: first,
      inReplyTo: "",
      createdAt: new Date(base - 26 * 3600_000).toISOString(),
    },
    {
      ...common,
      id: `demo-in-${lead.id}`,
      direction: "inbound",
      from: lead.email,
      fromName: lead.name,
      to: DEMO_ACCOUNT.account!.address,
      subject: "Re: Görüşmemizin özeti ve teklifimiz",
      text: "Merhaba,\n\nTeklifi inceledim, teşekkürler. Ödeme planı hakkında birkaç sorum var; perşembe öğleden sonra arayabilir misiniz?\n\nSaygılarımla",
      attachments: ["odeme-plani-sorular.pdf"],
      messageId: `<demo-2-${lead.id}@ornek-musteri.com>`,
      inReplyTo: first,
      references: [first],
      createdAt: new Date(base - 3 * 3600_000).toISOString(),
    },
  ];
}

export interface LeadEmails {
  messages: EmailMessage[];
  status: EmailStatus | null;
  /** Posta kutusu bağlı mı (demo modunda örnek bağlantı)? */
  connected: boolean;
  reload: () => Promise<void>;
  send: (input: { subject: string; text: string; replyToId?: string }) => Promise<void>;
}

export function useLeadEmails(lead: Lead): LeadEmails {
  const { demo, request } = useStore();
  const { status } = useEmailStatus();
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const reload = useCallback(async () => {
    if (demo) {
      if (!demoMessages.has(lead.id)) demoMessages.set(lead.id, demoThread(lead));
      setMessages([...(demoMessages.get(lead.id) || [])]);
      return;
    }
    try {
      const result = await request(`/api/email/messages?leadId=${encodeURIComponent(lead.id)}`);
      setMessages(Array.isArray(result.messages) ? result.messages : []);
    } catch {
      // Yazışmalar okunamazsa (ör. özellik kapalı) kartın geri kalanı etkilenmez.
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, request, lead.id, lead.email]);
  useEffect(() => {
    void reload();
    if (demo) return;
    // Açık kartta yeni yanıtlar kendiliğinden görünsün.
    const timer = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(timer);
  }, [demo, reload]);
  const send: LeadEmails["send"] = async (input) => {
    if (demo) {
      const original = (demoMessages.get(lead.id) || []).find((m) => m.id === input.replyToId);
      const message: EmailMessage = {
        id: `demo-${crypto.randomUUID()}`,
        leadId: lead.id,
        userOpenId: "demo",
        direction: "outbound",
        from: demoStatus.account?.address || DEMO_ACCOUNT.account!.address,
        fromName: demoStatus.account?.displayName || "",
        to: lead.email,
        subject: input.subject,
        text: input.text,
        truncated: false,
        attachments: [],
        messageId: `<demo-${Date.now()}@ornek-firma.com>`,
        inReplyTo: original?.messageId || "",
        references: original ? [...original.references, original.messageId] : [],
        createdAt: new Date().toISOString(),
      };
      demoMessages.set(lead.id, [message, ...(demoMessages.get(lead.id) || demoThread(lead))]);
      await reload();
      return;
    }
    await request("/api/email/send", { leadId: lead.id, ...input });
    await reload();
  };
  return { messages, status, connected: Boolean(status?.connected), reload, send };
}

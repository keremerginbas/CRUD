import { useEffect, useRef, useState } from "react";
import { PhoneIncoming, UserPlus, X, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { formatPhone, lines, type Lead } from "../data";
import "../pbx.css";

interface Ringing {
  id: string;
  phone: string;
  ext?: string;
  lineId?: string;
  direction: "inbound" | "outbound";
  lead: { id: string; name: string; phone: string; stage: string; owner: string; company?: string } | null;
  at: string;
}

/** Santralden gelen "çalıyor" olaylarını dinler ve müşteri kartını öne çıkarır. */
export default function IncomingCall({ onLead }: { onLead: (id: string) => void }) {
  const { demo, user, data, saveLead, refresh } = useStore();
  const [calls, setCalls] = useState<Ringing[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    if (demo || !user || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/pbx/stream", { withCredentials: true });
    source.addEventListener("ringing", (e) => {
      const call = JSON.parse((e as MessageEvent).data) as Ringing;
      setCalls((prev) => [call, ...prev.filter((c) => c.id !== call.id)].slice(0, 3));
      const timer = window.setTimeout(() => setCalls((prev) => prev.filter((c) => c.id !== call.id)), 90_000);
      timers.current.set(call.id, timer);
      if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted")
        new Notification(`Gelen arama · ${call.lead?.name || formatPhone(`+${call.phone}`)}`, {
          body: call.lead ? `${call.lead.company || ""} ${call.lead.owner ? `· ${call.lead.owner}` : ""}` : "Kayıtlı müşteri değil",
          tag: call.id,
        });
    });
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
    return () => {
      source.close();
      for (const t of timers.current.values()) clearTimeout(t);
    };
  }, [demo, user?.openId]);

  const dismiss = (id: string) => setCalls((prev) => prev.filter((c) => c.id !== id));

  const createLead = async (call: Ringing) => {
    const stamp = new Date().toISOString();
    const lead: Lead = {
      id: crypto.randomUUID(),
      name: formatPhone(`+${call.phone}`),
      phone: `+${call.phone}`,
      email: "",
      company: "",
      stage: "new",
      owner: user?.name || "",
      value: 0,
      source: "Telefon",
      notes: "",
      createdAt: stamp,
      lastActivity: stamp,
      tags: ["Gelen arama"],
    };
    try {
      await saveLead(lead);
      await refresh();
      dismiss(call.id);
      onLead(lead.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!calls.length) return null;
  return (
    <div className="incoming-calls" aria-live="assertive">
      {calls.map((call) => {
        const known = call.lead && data.leads.some((l) => l.id === call.lead!.id);
        const line = lines.find((l) => l.id === call.lineId);
        return (
          <article key={call.id} className="incoming-call">
            <span className="incoming-ring"><PhoneIncoming size={20} /></span>
            <div className="incoming-body">
              <small>
                {call.direction === "inbound" ? "Gelen arama" : "Giden arama"}
                {call.ext && ` · Dahili ${call.ext}`}
                {line && ` · ${formatPhone(line.phone)}`}
              </small>
              <strong>{call.lead?.name || formatPhone(`+${call.phone}`)}</strong>
              <span>
                {call.lead
                  ? [call.lead.company, call.lead.owner && `Danışman: ${call.lead.owner}`].filter(Boolean).join(" · ") || formatPhone(`+${call.phone}`)
                  : "CRM'de kayıtlı değil"}
              </span>
              <div className="incoming-actions">
                {call.lead ? (
                  <button
                    className="btn primary small"
                    onClick={async () => {
                      if (!known) await refresh();
                      onLead(call.lead!.id);
                      dismiss(call.id);
                    }}
                  >
                    <ArrowUpRight size={14} /> Müşteri kartı
                  </button>
                ) : (
                  <button className="btn primary small" onClick={() => void createLead(call)}>
                    <UserPlus size={14} /> Müşteri oluştur
                  </button>
                )}
              </div>
            </div>
            <button className="icon-button" aria-label="Bildirimi kapat" onClick={() => dismiss(call.id)}>
              <X size={16} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

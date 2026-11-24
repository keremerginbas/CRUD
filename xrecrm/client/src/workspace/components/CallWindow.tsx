// Tıkla-ara sonrası açılan arama penceresi: kimin arandığını, aramanın durumunu ve süresini
// gösterir; görüşme notu müşteri kartına yorum olarak düşer. Konuşma masa telefonundan yapılır.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Phone, PhoneOff, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { formatPhone } from "../data";
import "../pbx.css";

export interface ActiveCall {
  callId: string;
  leadId: string;
  phone: string;
  startedAt: number;
  /** Aramanın yapıldığı dahili (değiştirme bağlantısı için). */
  ext?: string;
}
let current: ActiveCall | null = null;
const listeners = new Set<(call: ActiveCall | null) => void>();
/** Arama başlatıldığında pencereyi açar. */
export function openCallWindow(call: Omit<ActiveCall, "startedAt">) {
  current = { ...call, startedAt: Date.now() };
  for (const fn of listeners) fn(current);
}

const LIVE = new Set(["queued", "ringing", "in-progress", "answered-live"]);
/** Arama kaydının durumunu pencerede gösterilecek kısa metne çevirir. */
export function callWindowState(status: string | undefined, elapsedSeconds: number): { text: string; tone: "wait" | "live" | "done" | "missed" } {
  if (status === "in-progress") return { text: "Görüşme sürüyor", tone: "live" };
  if (status === "ringing") return { text: "Müşteri aranıyor…", tone: "wait" };
  if (status === "ended" || status === "answered" || status === "completed") return { text: "Görüşme bitti", tone: "done" };
  if (status === "missed" || status === "no-answer" || status === "busy" || status === "failed") return { text: "Cevap alınamadı", tone: "missed" };
  // Santralden henüz haber gelmedi: önce çalışanın kendi telefonu çalar.
  return { text: elapsedSeconds < 90 ? "Telefonunuz çalıyor, açın…" : "Santralden yanıt bekleniyor", tone: "wait" };
}
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export default function CallWindow({ onLead }: { onLead: (id: string) => void }) {
  const { data, refresh, addNote, request } = useStore();
  const changeExtension = async () => {
    const next = window.prompt("Dahili numaranız (sonraki aramalarda kullanılır):", call?.ext || "");
    if (next === null) return;
    const clean = next.replace(/\D/g, "").slice(0, 6);
    if (!clean) return void toast.error("Dahili yalnız rakamlardan oluşur (ör. 125).");
    try {
      await request("/api/pbx/me", { extension: clean }, "PUT");
      setCall((current) => (current ? { ...current, ext: clean } : current));
      toast.success(`Dahiliniz ${clean} olarak kaydedildi.`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const [call, setCall] = useState<ActiveCall | null>(current);
  const [now, setNow] = useState(Date.now());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const fn = (next: ActiveCall | null) => {
      setCall(next);
      setNote("");
      setNow(Date.now());
    };
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  const record = call ? (data.calls as { id: string; status?: string; durationSeconds?: number }[]).find((c) => c.id === call.callId) : undefined;
  const elapsed = call ? Math.max(0, Math.round((now - call.startedAt) / 1000)) : 0;
  const state = callWindowState(record?.status, elapsed);
  const active = Boolean(call) && (state.tone === "wait" || state.tone === "live");
  useEffect(() => {
    if (!call) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [call?.callId]);
  // Canlı güncelleme gecikirse durum birkaç saniyede bir yenilenir (en çok 10 dakika).
  useEffect(() => {
    if (!call || !active || elapsed > 600) return;
    const poll = window.setInterval(() => void (refresh as (soft?: boolean) => Promise<void>)(true).catch(() => undefined), 4000);
    return () => clearInterval(poll);
  }, [call?.callId, active, elapsed > 600]);
  if (!call) return null;
  const lead = data.leads.find((l) => l.id === call.leadId);
  const close = () => {
    current = null;
    setCall(null);
  };
  const saveNote = async () => {
    const text = note.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await addNote(call.leadId, `📞 Görüşme notu: ${text}`);
      setNote("");
      toast.success("Not müşteri kartına eklendi.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const duration = record?.durationSeconds ? clock(Math.round(record.durationSeconds)) : "";
  // Üst çubuğun dışına, ekranın ortasına çizilir; müşteri kartı açıkken de kartın üstünde kalır.
  return createPortal(
    <div className={`call-window ${state.tone}`} role="dialog" aria-label="Arama penceresi">
      <header>
        <span className="call-window-icon" aria-hidden="true">
          {state.tone === "missed" ? <PhoneOff size={18} /> : <Phone size={18} />}
        </span>
        <div>
          <strong>{lead?.name || formatPhone(call.phone)}</strong>
          <small>{formatPhone(call.phone)}</small>
        </div>
        <button type="button" className="icon-button" onClick={close} aria-label="Pencereyi kapat">
          <X size={16} />
        </button>
      </header>
      <div className="call-window-state" aria-live="polite">
        <b>{state.text}</b>
        <span>{active ? clock(elapsed) : duration}</span>
      </div>
      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Görüşme notu yazın; müşteri kartına yorum olarak düşer…" maxLength={2000} />
      <footer>
        {lead && (
          <button type="button" className="btn secondary" onClick={() => onLead(lead.id)}>
            Kartı aç <ArrowUpRight size={14} />
          </button>
        )}
        <button type="button" className="btn primary" disabled={!note.trim() || saving} onClick={saveNote}>
          Notu kaydet
        </button>
      </footer>
      <small className="call-window-hint">
        Görüşmeyi telefonunuzdan yapar ve kapatırsınız; süre ve sonuç karta kendiliğinden yazılır.
        {call.ext && (
          <>
            {" "}
            Dahili {call.ext} ·{" "}
            <button type="button" className="call-window-link" onClick={() => void changeExtension()}>
              değiştir
            </button>
          </>
        )}
      </small>
    </div>,
    document.querySelector(".app-shell") || document.body,
  );
}

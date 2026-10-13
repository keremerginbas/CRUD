import { useState } from "react";
import {
  MessageSquare,
  CalendarClock,
  Sparkles,
  Check,
  Phone,
  MessageCircle,
  Clock,
  Edit3,
  FileText,
  Send,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Lead } from "../data";
import { Activity, dateTimeLabel } from "../suite";
import {
  appointmentIso,
  appointmentParts,
} from "../../../../shared/appointments";
import { Avatar, Badge } from "./ui";
export default function CustomerTimeline({ lead }: { lead: Lead }) {
  const { data, saveRecord, addNote, demo, request, refresh, user } =
    useStore();
  const [tab, setTab] = useState("comment");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("Müşteriyle görüşün");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [editing, setEditing] = useState<Activity | null>(null);
  const activities = data.activities.filter(
    (a) => a.leadId === lead.id && !a.cancelled,
  );
  const notes = data.feed.filter(
    (p) =>
      p.leadId === lead.id ||
      (lead.contactId && (p as any).contactId === lead.contactId),
  );
  const stream = [
    ...notes.map((p) => ({
      id: p.id,
      date: p.createdAt,
      title: p.author,
      text: p.text,
      type: (p as any).kind === "ai-analysis" ? "analysis" : "comment",
      source: (p as any).sourceKind,
    })),
    ...data.messages
      .filter((m) => m.leadId === lead.id)
      .map((m) => ({
        id: m.id,
        date: m.createdAt,
        title:
          m.direction === "inbound"
            ? `${lead.name} · gelen WhatsApp`
            : `${user?.name || "XRE"} → ${lead.name}`,
        text: m.text,
        type: "message",
        source: "",
      })),
    ...data.calls
      .filter((c) => c.leadId === lead.id)
      .map((c) => ({
        id: c.id,
        date: c.createdAt,
        title: "Telefon görüşmesi",
        text: c.summary || c.status,
        type: "call",
        source: "",
      })),
    ...activities
      .filter((a) => a.completed)
      .map((a) => ({
        id: a.id,
        date: a.updatedAt,
        title: a.title + " · tamamlandı",
        text: a.description,
        type: "activity",
        source: "",
      })),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      if (tab === "comment") {
        if (!text.trim()) throw new Error("Yorum metni gerekli.");
        await addNote(lead.id, text.trim());
        setText("");
      } else {
        if (!day || !time)
          throw new Error("Etkinlik için tarih ve saat seçmelisiniz.");
        const startAt = appointmentIso(day, time);
        const stamp = new Date().toISOString();
        await saveRecord("activities", {
          ...editing,
          id: editing?.id || crypto.randomUUID(),
          leadId: lead.id,
          title: title.trim() || "Müşteriyle görüşün",
          type: "meeting",
          description: text.trim(),
          assignee: lead.owner,
          startAt,
          endAt: new Date(Date.parse(startAt) + 1800000).toISOString(),
          completed: false,
          createdAt: editing?.createdAt || stamp,
          updatedAt: stamp,
        });
        setText("");
        setDay("");
        setTime("");
        setTitle("Müşteriyle görüşün");
        setEditing(null);
        toast.success("Etkinlik kaydedildi; aşağıdaki yapılacaklara eklendi.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (demo) {
      toast.info("Demo görüşmeleri dış yapay zekâya gönderilmez.");
      return;
    }
    setBusy(true);
    try {
      await request(`/api/leads/${lead.id}/analyze`, {});
      await refresh();
      toast.success(
        "Görüşme analizi kuyruğa alındı; yorum hazır olunca burada görünür.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cx-timeline">
      <div className="cx-composer">
        <div className="cx-composer-tabs">
          <button
            className={tab === "comment" ? "active" : ""}
            onClick={() => {
              setTab("comment");
              setEditing(null);
              setText("");
            }}
          >
            Yorum
          </button>
          <button
            className={tab === "activity" ? "active" : ""}
            onClick={() => {
              setTab("activity");
              setText("");
            }}
          >
            Etkinlik
          </button>
          <button onClick={analyze} disabled={busy}>
            <Sparkles size={12} />
            Görüşmeleri analiz et
          </button>
        </div>
        <div
          className={`cx-compose-box ${tab === "activity" ? "activity" : ""}`}
        >
          {tab === "activity" && (
            <input
              className="cx-title-input"
              aria-label="Etkinlik başlığı"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={tab === "activity" ? 3 : 2}
            placeholder={
              tab === "comment"
                ? "Yorum bırakın…"
                : "Görüşmenin amacı veya açıklama girin…"
            }
            aria-label={
              tab === "comment" ? "Yorum metni" : "Etkinlik açıklaması"
            }
          />
          {tab === "activity" && (
            <div className="cx-inline-dates">
              <label>
                <CalendarClock size={13} />
                <input
                  required
                  type="date"
                  aria-label="Etkinlik günü"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              <label>
                <Clock size={13} />
                <input
                  required
                  type="time"
                  aria-label="Etkinlik saati"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
              <small>Türkiye saati · 10 dk önce hatırlat</small>
            </div>
          )}
        </div>
        <footer>
          <button
            className="btn primary small"
            disabled={
              busy ||
              (tab === "comment" && !text.trim()) ||
              (tab === "activity" && (!day || !time))
            }
            onClick={save}
          >
            {busy ? <LoaderCircle size={13} /> : <Send size={13} />}KAYDET
          </button>
          {editing && (
            <button
              className="text-button"
              onClick={() => {
                setEditing(null);
                setText("");
                setDay("");
                setTime("");
              }}
            >
              İptal
            </button>
          )}
          <span>İç kayıt · müşteriye gönderilmez</span>
        </footer>
      </div>
      <div className="cx-discuss">
        <MessageSquare size={14} />
        Müşteri çalışma alanı
        <Badge tone={demo ? "amber" : "gray"}>
          {demo ? "Örnek veri" : "Canlı kayıt"}
        </Badge>
      </div>
      <div className="cx-section-divider">
        <span>Yapılacaklar</span>
      </div>
      <div className="cx-todos">
        {activities
          .filter((a) => !a.completed)
          .map((a) => (
            <article key={a.id} className="cx-todo">
              <span className="cx-calendar-tile">
                <CalendarClock size={22} />
                <b>
                  {new Date(a.startAt).toLocaleDateString("tr-TR", {
                    timeZone: "Europe/Istanbul",
                    day: "numeric",
                    month: "short",
                  })}
                </b>
              </span>
              <div>
                <strong>{a.title}</strong>
                <time>{dateTimeLabel(a.startAt)}</time>
                {a.description && <p>{a.description}</p>}
                <footer>
                  <button
                    className="btn primary small"
                    onClick={async () => {
                      try {
                        await saveRecord("activities", {
                          ...a,
                          completed: true,
                          updatedAt: new Date().toISOString(),
                        });
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    <Check size={13} />
                    Tamamlanan
                  </button>
                  <button
                    className="btn secondary small"
                    onClick={() => {
                      const d = appointmentParts(a.startAt);
                      setEditing(a);
                      setTab("activity");
                      setText(a.description);
                      setTitle(a.title);
                      setDay(d.day);
                      setTime(d.time);
                    }}
                  >
                    <Edit3 size={12} />
                    Düzenle
                  </button>
                </footer>
              </div>
              <Avatar name={a.assignee || lead.owner} size={21} />
            </article>
          ))}
        {!activities.some((a) => !a.completed) && (
          <div className="cx-no-todos">
            <CalendarClock size={17} />
            Planlı görüşme yok. Etkinlik sekmesinden ekleyin.
          </div>
        )}
      </div>
      <div className="cx-section-divider blue">
        <span>İletişim ve yorum geçmişi</span>
      </div>
      <div className="cx-history">
        {stream.map((s) => (
          <article key={`${s.type}-${s.id}`}>
            <span className={`cx-event-dot ${s.type}`}>
              {s.type === "analysis" ? (
                <Sparkles size={15} />
              ) : s.type === "message" ? (
                <MessageCircle size={15} />
              ) : s.type === "call" ? (
                <Phone size={15} />
              ) : (
                <FileText size={15} />
              )}
            </span>
            <div>
              <header>
                <strong>{s.title}</strong>
                <time>{dateTimeLabel(s.date)}</time>
              </header>
              <p>{s.text}</p>
              {s.type === "analysis" && (
                <small className="cx-ai-caption">
                  Yapay zekâ yorumu ·{" "}
                  {s.source === "call"
                    ? "Telefon görüşmesi"
                    : "WhatsApp konuşması"}{" "}
                  · Kaynak kaydıyla bağlı
                </small>
              )}
            </div>
          </article>
        ))}
        {!stream.length && (
          <div className="cx-no-todos">
            <MessageSquare size={17} />
            İlk yorumu veya görüşmeyi kaydedin.
          </div>
        )}
      </div>
    </section>
  );
}

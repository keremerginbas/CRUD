import { MeetingInputSchema } from "../../../../shared/meetings";
import { useEffect, useRef, useState } from "react";
import {
  Video,
  CalendarClock,
  Link2,
  Copy,
  MessageCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Modal } from "./ui";
import {
  appointmentIso,
  appointmentParts,
} from "../../../../shared/appointments";
import type { Activity } from "../suite";

export function meetingShareText(
  activity: Pick<Activity, "title" | "startAt" | "meetingUrl">,
  customer: string,
) {
  const p = appointmentParts(activity.startAt);
  return `Merhaba ${customer}, ${activity.title} için ${p.day.split("-").reverse().join(".")} tarihinde saat ${p.time} (Türkiye saati) görüşebiliriz.\nToplantı bağlantısı: ${activity.meetingUrl || ""}`;
}
export default function OnlineMeeting({
  leadId,
  onClose,
  onShare,
}: {
  leadId?: string;
  onClose: () => void;
  onShare: (leadId: string, text: string) => void;
}) {
  const { data, demo, user, request, saveRecord, refresh } = useStore();
  const [customer, setCustomer] = useState(leadId || "");
  const lead = data.leads.find((l) => l.id === customer);
  const [title, setTitle] = useState("Online müşteri görüşmesi");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [assignee, setAssignee] = useState(
    lead?.owner || user?.name || data.members[0]?.name || "",
  );
  const [attendees, setAttendees] = useState("");
  const [description, setDescription] = useState("");
  const [invites, setInvites] = useState(false);
  const [provider, setProvider] = useState<"google" | "manual">("google");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const id = useRef(crypto.randomUUID());
  const locked = useRef(false);
  const intent = useRef<any>(null);
  const can = demo || user?.isOwner || !!user?.permissions?.calendar?.write;
  useEffect(() => {
    let valid = true;
    if (!demo)
      request("/api/google-calendar/status")
        .then((r) => {
          if (valid) setStatus(r);
        })
        .catch((e) => {
          if (valid) setError(e.message);
        });
    return () => {
      valid = false;
    };
  }, [demo, request]);
  async function connect() {
    if (locked.current || demo) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await request("/api/google-calendar/connect", {});
      if (r.authorizeUrl) {
        location.assign(r.authorizeUrl);
      } else
        throw new Error(r.message || "Google bağlantısı henüz kurulmamış.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current || !can) return;
    setError("");
    let start: string;
    try {
      if (!lead) throw new Error("CRM müşterisi seçin.");
      start = appointmentIso(day, time);
      if (Date.parse(start) <= Date.now())
        throw new Error("Toplantı tarihi ve saati gelecekte olmalıdır.");
      if (!title.trim()) throw new Error("Toplantı başlığı gerekli.");
      if (
        !MeetingInputSchema.safeParse({
          requestId: id.current,
          leadId: customer,
          title: title.trim(),
          date: day,
          time,
          durationMinutes: duration,
          assignee,
          attendees: [
            ...new Set(
              attendees
                .split(/[;,\n]/)
                .map((x) => x.trim())
                .filter(Boolean),
            ),
          ],
          description,
          sendInvites: invites,
          provider,
          ...(provider === "manual" ? { meetingUrl: url.trim() } : {}),
        }).success
      )
        throw new Error(
          "Toplantı alanlarını ve katılımcı e-posta adreslerini kontrol edin.",
        );
      if (
        provider === "manual" &&
        !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(
          url.trim(),
        )
      )
        throw new Error("Geçerli Google Meet bağlantısı ekleyin.");
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      if (demo) {
        const stamp = new Date().toISOString();
        const activity: Activity = {
          id: id.current,
          title: title.trim(),
          leadId: customer,
          type: "meeting",
          description,
          startAt: start!,
          endAt: new Date(Date.parse(start!) + duration * 60000).toISOString(),
          assignee,
          completed: false,
          createdAt: stamp,
          updatedAt: stamp,
          ...(provider === "manual"
            ? {
                meetingUrl: url.trim(),
                conferenceStatus: "ready" as const,
                meetingProvider: "manual" as const,
              }
            : { conferenceStatus: "unavailable" as const }),
        };
        await saveRecord("activities", activity);
        setResult({
          activity,
          meetingUrl: activity.meetingUrl,
          conferenceStatus: activity.meetingUrl ? "ready" : "unavailable",
        });
        toast.success(
          "Demo toplantı kaydedildi. Google’a istek veya davet gönderilmedi.",
        );
      } else {
        intent.current = intent.current || {
          requestId: id.current,
          leadId: customer,
          title: title.trim(),
          date: day,
          time,
          durationMinutes: duration,
          assignee,
          attendees: [
            ...new Set(
              attendees
                .split(/[;,\n]/)
                .map((x) => x.trim())
                .filter(Boolean),
            ),
          ],
          description,
          sendInvites: invites,
          provider,
          ...(provider === "manual" ? { meetingUrl: url.trim() } : {}),
        };
        const r = await request("/api/meetings", intent.current);
        setResult(r);
        await refresh();
        if (r.conferenceStatus === "failed")
          toast.error(
            r.message || "Google toplantı bağlantısı oluşturulamadı.",
          );
        else
          toast.success(
            r.conferenceStatus === "ready"
              ? "Toplantı ve Meet bağlantısı kaydedildi."
              : "Toplantı isteği kaydedildi; bağlantı sonucu kontrol edilmeli.",
          );
      }
    } catch (e) {
      const code = (e as Error & { status?: number }).status;
      if (code && code >= 400 && code < 500 && code !== 409)
        intent.current = null;
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function check() {
    if (locked.current || demo) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await request(`/api/meetings/${id.current}`);
      setResult(r);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const join = result?.meetingUrl || result?.activity?.meetingUrl;
  return (
    <Modal
      wide
      title="Online toplantı planla"
      subtitle={
        lead
          ? `${lead.name} · CRM ve takvim kaydı`
          : "Google Meet · Müşteri görüşmesi"
      }
      onClose={onClose}
    >
      {result ? (
        <div className="modal-content v6-meeting-result">
          <span className="v6-meeting-icon">
            <Video size={28} />
          </span>
          <h3>{result.activity?.title || title}</h3>
          <p>
            {day.split("-").reverse().join(".")} · {time} · {duration} dakika ·
            Türkiye saati
          </p>
          {join ? (
            <>
              <a
                href={join}
                target="_blank"
                rel="noreferrer"
                className="v6-meet-link"
              >
                <Link2 size={17} />
                {join}
              </a>
              <div className="v6-meet-result-actions">
                <a
                  className="btn primary"
                  href={join}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Video size={16} />
                  Toplantıya katıl
                </a>
                <button
                  className="btn secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(join)
                      .then(() => toast.success("Bağlantı kopyalandı."))
                      .catch(() => toast.error("Panoya erişilemedi."))
                  }
                >
                  <Copy size={16} />
                  Kopyala
                </button>
                <button
                  className="btn secondary"
                  onClick={() => {
                    const a = result.activity as Activity;
                    onShare(
                      customer,
                      meetingShareText(
                        a || {
                          title,
                          startAt: appointmentIso(day, time),
                          meetingUrl: join,
                        },
                        lead?.name || "",
                      ),
                    );
                    onClose();
                  }}
                >
                  <MessageCircle size={16} />
                  WhatsApp taslağı
                </button>
              </div>
            </>
          ) : (
            <div className="info-banner">
              <CalendarClock size={18} />
              <p>
                {demo
                  ? "Demo planlama kaydı oluşturuldu. Gerçek Meet bağlantısı üretilmedi."
                  : result.message ||
                    (result.conferenceStatus === "failed"
                      ? "Google konferansı oluşturulamadı. Mevcut CRM kaydı hata durumuyla korunuyor."
                      : "Google konferansı henüz hazır değil; aynı isteğin durumunu kontrol edin.")}
              </p>
              {!demo && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  <RefreshCw size={15} />
                  Durumu kontrol et
                </button>
              )}
            </div>
          )}
          <small>
            Toplantı kaydı müşterinin etkinlik akışında ve takvimde görünür.
            WhatsApp paylaşımı ayrı gönderim gerektirir.
          </small>
          {error && (
            <p role="alert" className="v6-error">
              {error}
            </p>
          )}
          <button className="btn secondary" onClick={onClose}>
            Kapat
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="v6-meeting-form">
          <div className="v6-meeting-provider">
            <Video size={22} />
            <div>
              <strong>Google Meet</strong>
              <span>
                {demo
                  ? "Demo: yalnız CRM planlama kaydı"
                  : status?.connected
                    ? "Google hesabı bağlı"
                    : "Google hesabını bağlayın veya mevcut bağlantıyı ekleyin"}
              </span>
            </div>
            {!demo && !status?.connected && (
              <button
                className="btn secondary small"
                type="button"
                disabled={busy}
                onClick={() => void connect()}
              >
                Google hesabını bağla
                <ExternalLink size={14} />
              </button>
            )}
          </div>
          {!demo && status?.setupRequired && (
            <p className="v6-setup-note">
              Google OAuth uygulama kurulumu gerekli. Bağlantı yoksa Google
              Meet’te oluşturduğunuz bağlantıyı aşağıdaki seçenekle
              ekleyebilirsiniz.
            </p>
          )}
          <fieldset
            disabled={busy || !can || !!intent.current}
            className="v6-meeting-fields"
          >
            <label className="full">
              Toplantı başlığı
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="full">
              CRM müşterisi
              <select
                required
                value={customer}
                onChange={(e) => {
                  setCustomer(e.target.value);
                  const l = data.leads.find((l) => l.id === e.target.value);
                  if (l) setAssignee(l.owner);
                }}
              >
                <option value="">Müşteri seçin</option>
                {data.leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.phone}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Toplantı tarihi
              <input
                required
                type="date"
                min={appointmentParts(new Date().toISOString()).day}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <label>
              Toplantı saati
              <input
                required
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <label>
              Süre
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {[15, 30, 45, 60, 90, 120, 180, 240].map((n) => (
                  <option key={n} value={n}>
                    {n} dakika
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sorumlu
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                {[
                  ...new Set(
                    [assignee, ...data.members.map((m) => m.name)].filter(
                      Boolean,
                    ),
                  ),
                ].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Bağlantı yöntemi
              <select
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as "google" | "manual")
                }
              >
                <option value="google">
                  {demo
                    ? "Demo toplantı planı (link üretmez)"
                    : "Google Meet bağlantısı oluştur"}
                </option>
                <option value="manual">
                  Mevcut Google Meet bağlantısını ekle
                </option>
              </select>
            </label>
            {provider === "manual" && (
              <label className="full">
                Google Meet bağlantısı
                <input
                  required
                  type="url"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <a
                  href="https://meet.google.com/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Meet’te bağlantı oluştur <ExternalLink size={12} />
                </a>
              </label>
            )}
            <label className="full">
              Katılımcı e-postaları
              <textarea
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="Virgülle ayırın. Google davetleri yalnız aşağıdaki seçeneği açınca gönderilir."
                rows={2}
              />
            </label>
            <label className="full">
              Açıklama
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Görüşme amacı ve gündem"
              />
            </label>
            {provider === "google" && (
              <label className="v6-invite-check full">
                <input
                  type="checkbox"
                  checked={invites}
                  onChange={(e) => setInvites(e.target.checked)}
                />
                Google Calendar davet e-postalarını katılımcılara gönder
              </label>
            )}
          </fieldset>
          {error && (
            <div role="alert" className="v6-error">
              {error}
              {intent.current && !demo && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  Aynı isteğin sonucunu kontrol et
                </button>
              )}
            </div>
          )}
          <footer className="modal-footer">
            <span>
              <ShieldCheck size={14} />
              {demo
                ? "Dış işlem yapılmaz"
                : "Tarih ve saat zorunlu · Türkiye saati"}
            </span>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={onClose}
            >
              Vazgeç
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={
                busy ||
                !can ||
                (!demo && provider === "google" && !status?.connected)
              }
            >
              <Video size={16} />
              {busy
                ? "Kaydediliyor…"
                : demo
                  ? "Demo toplantısını kaydet"
                  : "Toplantıyı kaydet"}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { appointmentParts } from "../../../../shared/appointments";
export default function AppointmentNotifications({
  onLead,
}: {
  onLead: (id: string) => void;
}) {
  const { data, demo, user, request } = useStore();
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const shown = useRef(new Set<string>());
  useEffect(() => {
    shown.current = new Set<string>();
    setItems([]);
  }, [demo, user?.openId]);
  useEffect(() => {
    let stop = false;
    async function update() {
      let list: any[] = [];
      if (demo) {
        list = data.activities
          .filter(
            (a) =>
              !a.completed &&
              !a.cancelled &&
              Date.parse(a.startAt) > Date.now() &&
              Date.parse(a.startAt) - Date.now() <= 600000,
          )
          .map((a) => ({
            id: `${a.id}:${a.startAt}`,
            leadId: a.leadId,
            title: `${data.leads.find((l) => l.id === a.leadId)?.name || "Müşteri"} · randevunuza ${Math.max(1, Math.ceil((Date.parse(a.startAt) - Date.now()) / 60000))} dk kaldı`,
            startAt: a.startAt,
            read:
              localStorage.getItem(`xre-notification:${a.id}:${a.startAt}`) ===
              "read",
          }));
      } else if (user?.canAccess) {
        try {
          list = (await request("/api/notifications")).data || [];
        } catch {
          return;
        }
      }
      if (stop) return;
      setItems(list);
      for (const n of list) {
        const key = `xre-notification:${user?.openId || "demo"}:${n.id}`;
        if (n.read || shown.current.has(key) || sessionStorage.getItem(key))
          continue;
        shown.current.add(key);
        sessionStorage.setItem(key, "shown");
        toast.info(n.title, {
          duration: 10000,
          action: { label: "Kartı aç", onClick: () => onLead(n.leadId) },
        });
      }
    }
    void update();
    const timer = setInterval(() => void update(), 30000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [data.activities, data.leads, demo, user?.openId]);
  async function read(item: any) {
    if (demo) localStorage.setItem(`xre-notification:${item.id}`, "read");
    else
      await request(`/api/notifications/${item.id}/read`, {}).catch(() => {});
    setItems((xs) =>
      xs.map((x) => (x.id === item.id ? { ...x, read: true } : x)),
    );
  }
  return (
    <div className="cx-notification-wrap">
      <button
        className="icon-button"
        aria-label="Randevu bildirimleri"
        onClick={() => setOpen(!open)}
      >
        <CalendarClock size={19} />
        {items.some((i) => !i.read) && <i />}
      </button>
      {open && (
        <div className="cx-notification-panel">
          <header>
            <h3>Randevu hatırlatmaları</h3>
            <button
              aria-label="Hatırlatmaları kapat"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          {items.length ? (
            items.map((n) => (
              <article key={n.id} className={n.read ? "read" : ""}>
                <Bell size={15} />
                <button
                  onClick={() => {
                    onLead(n.leadId);
                    setOpen(false);
                    void read(n);
                  }}
                >
                  <strong>{n.title}</strong>
                  <small>
                    {appointmentParts(n.startAt).day} ·{" "}
                    {appointmentParts(n.startAt).time} · Türkiye saati
                  </small>
                </button>
                <button aria-label="Okundu işaretle" onClick={() => read(n)}>
                  <Check size={13} />
                </button>
              </article>
            ))
          ) : (
            <p>Önümüzdeki 10 dakika içinde randevu yok.</p>
          )}
          <footer>
            Uygulama içi bildirimler · tarayıcı kapalıyken push gönderilmez.
          </footer>
        </div>
      )}
    </div>
  );
}

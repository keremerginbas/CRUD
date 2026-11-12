import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useStore } from "../store";
import type { InboxNotification } from "../../../../shared/triggers";

/** Kullanıcının bildirim kutusu durumu: okunmamış sayısı ve son bildirimler. */
export function useInbox() {
  const { demo, user, request } = useStore();
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const live = !demo && Boolean(user);
  const load = () => {
    if (!live) return;
    request("/api/inbox")
      .then((r) => {
        setItems(r.notifications || []);
        setUnread(Number(r.unread) || 0);
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    if (!live) {
      setItems([]);
      setUnread(0);
      return;
    }
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [live]);
  const markRead = () => {
    if (!live || !unread) return;
    setUnread(0);
    request("/api/inbox/read", {}).catch(() => undefined);
  };
  return { items, unread, markRead, reload: load };
}

/** Zil menüsündeki "Bildirimler" bölümü. */
export function InboxList({ items, onLead }: { items: InboxNotification[]; onLead: (leadId: string) => void }) {
  if (!items.length) return null;
  return (
    <>
      <h3>Bildirimler</h3>
      {items.slice(0, 6).map((n) => (
        <button key={n.id} onClick={() => n.leadId && onLead(n.leadId)} className={n.readAt ? "" : "unread"}>
          <span className="activity-icon">
            <BellRing size={16} />
          </span>
          <span>
            <strong>{n.title}</strong>
            <small>
              {[n.body, new Date(n.createdAt).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </span>
        </button>
      ))}
    </>
  );
}

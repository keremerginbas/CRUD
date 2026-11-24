import { openCallWindow } from "./CallWindow";
import { useRef, useEffect, useState } from "react";
import {
  Phone,
  Headset,
  MessageCircle,
  CalendarPlus,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead } from "../data";
import { formatPhone } from "../data";
import { useStore } from "../store";
import { dialWithWebphone } from "../webphone";
import { Modal } from "./ui";

export function openOnlineMeeting(leadId?: string) {
  window.dispatchEvent(new CustomEvent("xre:meeting", { detail: { leadId } }));
}
export function openCustomerCall(leadId: string) {
  window.dispatchEvent(new CustomEvent("xre:call", { detail: { leadId } }));
}
export default function LeadQuickActions({
  lead,
  onMessage,
  onActivity,
}: {
  lead: Lead;
  onMessage: (id: string) => void;
  onActivity?: () => void;
}) {
  const { demo, user } = useStore();
  const can = (m: string) =>
    demo || user?.isOwner || !!user?.permissions?.[m]?.write;
  return (
    <div
      className="v6-quick-actions"
      aria-label={`${lead.name} hızlı işlemler`}
    >
      <button
        type="button"
        title={lead.phone ? `${lead.name} · Ara` : "Önce telefon ekleyin"}
        aria-label={`${lead.name} ara`}
        disabled={!lead.phone || !can("calls")}
        onClick={() => openCustomerCall(lead.id)}
      >
        <Phone size={15} />
        <span>Ara</span>
      </button>
      <button
        type="button"
        title="WhatsApp konuşmasını aç"
        aria-label={`${lead.name} WhatsApp`}
        disabled={!lead.phone || !can("whatsapp")}
        onClick={() => onMessage(lead.id)}
      >
        <MessageCircle size={15} />
        <span>WhatsApp</span>
      </button>
      {onActivity && (
        <button
          type="button"
          title="Etkinlik oluştur"
          aria-label={`${lead.name} etkinlik oluştur`}
          disabled={!can("calendar")}
          onClick={onActivity}
        >
          <CalendarPlus size={15} />
        </button>
      )}
      <button
        type="button"
        title="Online toplantı planla"
        aria-label={`${lead.name} online toplantı`}
        disabled={!can("calendar")}
        onClick={() => openOnlineMeeting(lead.id)}
      >
        <Video size={15} />
      </button>
    </div>
  );
}
function PbxCallBox({ leadId, phone, onDone }: { leadId: string; phone: string; onDone: () => void }) {
  const { request, refresh } = useStore();
  const [info, setInfo] = useState<{
    driver: string;
    extension: string;
    webphone?: { configured: boolean; hasPassword: boolean };
  } | null>(null);
  const [ext, setExt] = useState("");
  const [busy, setBusy] = useState(false);
  const autoStarted = useRef(false);
  const place = async (extension: string, saved: string) => {
    setBusy(true);
    try {
      if (extension !== saved) {
        await request("/api/pbx/me", { extension }, "PUT");
        setInfo((current) => (current ? { ...current, extension } : current));
      }
      const r = await request("/api/pbx/call", { leadId });
      // Arama penceresi durumu zaten gösterir; ayrıca bildirim çıkarılmaz.
      if (r.callId) openCallWindow({ callId: r.callId, leadId, phone, ext: extension });
      else toast.success(r.message);
      await refresh();
      onDone();
    } catch (e) {
      // Hata olursa pencere açık kalır; dahili buradan düzeltilebilir.
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    request("/api/pbx/me")
      .then((r: { driver: string; extension: string }) => {
        setInfo(r);
        setExt(r.extension);
        // Dahili daha önce kaydedildiyse yeniden sorulmaz: arama hemen başlar.
        if (r.driver && r.extension && !autoStarted.current) {
          autoStarted.current = true;
          void place(r.extension, r.extension);
        }
      })
      .catch(() => setInfo(null));
  }, []);
  const browserPhone = Boolean(info?.webphone?.configured);
  if (!info || (!info.driver && !browserPhone)) return null;
  const call = () => place(ext, info.extension);
  const browserCall = () => {
    if (!info.webphone?.hasPassword)
      toast.info("Önce üst çubuktaki telefon simgesinden dahili şifrenizi girin.");
    dialWithWebphone(phone, leadId);
    onDone();
  };
  if (!info.driver)
    return (
      <div className="pbx-call">
        <strong>Tarayıcıdan ara</strong>
        <div className="pbx-call-row">
          <button className="btn primary" onClick={browserCall}>
            <Headset size={16} />
            Kulaklıkla ara
          </button>
        </div>
        <small>Görüşme bu sekmede, kulaklığınız ve mikrofonunuzla yapılır.</small>
      </div>
    );
  return (
    <div className="pbx-call">
      <strong>Santralden ara</strong>
      <div className="pbx-call-row">
        <label>
          Dahili numaranız
          <input
            value={ext}
            inputMode="numeric"
            placeholder="101"
            onChange={(e) => setExt(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </label>
        <button className="btn primary" disabled={busy || !ext} onClick={() => void call()}>
          <Phone size={16} />
          {busy ? "Bağlanıyor…" : "Dahilimi çaldır ve ara"}
        </button>
        {browserPhone && (
          <button className="btn secondary" onClick={browserCall}>
            <Headset size={16} />
            Tarayıcıdan ara
          </button>
        )}
      </div>
      <small>
        Önce masanızdaki/softphone'daki dahili çalar; açınca müşteri aranır ve
        görüşme kaydı CRM'e otomatik düşer.
      </small>
    </div>
  );
}

export function CustomerCallDialog({
  leadId,
  onClose,
}: {
  leadId: string;
  onClose: () => void;
}) {
  const { data, demo, user } = useStore();
  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return null;
  const can = demo || user?.isOwner || !!user?.permissions?.calls?.write;
  const phone = lead.phone.replace(/[^+\d]/g, "");
  return (
    <Modal
      title={`${lead.name} · Arama`}
      subtitle={formatPhone(lead.phone)}
      onClose={onClose}
    >
      <div className="modal-content v6-call-modal">
        {!demo && (
          <PbxCallBox leadId={leadId} phone={lead.phone} onDone={onClose} />
        )}
        <p>
          Bilgisayarınızdaki veya telefonunuzdaki arama uygulamasıyla arayın.
        </p>
        {demo ? (
          <button
            className="btn primary"
            onClick={() =>
              toast.info("Demo modu: telefon uygulaması açılmadı.")
            }
          >
            <Phone size={16} />
            Demo aramasını dene
          </button>
        ) : (
          <a
            className={`btn primary ${!can ? "disabled" : ""}`}
            href={can ? `tel:${phone}` : undefined}
            onClick={(e) => {
              if (!can) e.preventDefault();
            }}
          >
            <Phone size={16} />
            Telefon uygulamasında ara
          </a>
        )}
        <small>
          Telefon uygulamasından yapılan aramalar karta otomatik yazılmaz.
        </small>
      </div>
    </Modal>
  );
}

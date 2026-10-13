import VapiCallFields, {
  useVapiOptions,
  canUseVapiSelection,
} from "./VapiCallFields";
import { useEffect, useRef, useState } from "react";
import {
  Phone,
  MessageCircle,
  CalendarPlus,
  Video,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead } from "../data";
import { lines, formatPhone } from "../data";
import { useStore } from "../store";
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
function PbxCallBox({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const { request, refresh } = useStore();
  const [info, setInfo] = useState<{ driver: string; extension: string } | null>(null);
  const [ext, setExt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request("/api/pbx/me")
      .then((r: { driver: string; extension: string }) => {
        setInfo(r);
        setExt(r.extension);
      })
      .catch(() => setInfo(null));
  }, []);
  if (!info?.driver) return null;
  const call = async () => {
    setBusy(true);
    try {
      if (ext !== info.extension) {
        await request("/api/pbx/me", { extension: ext }, "PUT");
        setInfo({ ...info, extension: ext });
      }
      const r = await request("/api/pbx/call", { leadId });
      toast.success(r.message);
      await refresh();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
  const { data, demo, request, refresh, user } = useStore();
  const lead = data.leads.find((l) => l.id === leadId);
  const [mode, setMode] = useState<"phone" | "ai">("phone");
  const [lineId, setLineId] = useState("");
  const [assistant, setAssistant] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const options = useVapiOptions(mode === "ai");
  if (!lead) return null;
  const can = demo || user?.isOwner || !!user?.permissions?.calls?.write;
  const phone = lead.phone.replace(/[^+\d]/g, "");
  async function call() {
    if (lock.current || !can || !lead) return;
    if (demo) {
      toast.info("Demo modu: gerçek arama yapılmadı.");
      return;
    }
    if (!canUseVapiSelection(options.catalog, lineId, assistant)) {
      toast.error("Doğrulanmış Vapi hattı ve asistanı seçin.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await request("/api/calls", {
        leadId,
        lineId,
        assistantId: assistant.trim() || undefined,
      });
      toast.success("Arama isteği Vapi sağlayıcısına iletildi.");
      await refresh();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${lead.name} · Arama`}
      subtitle={formatPhone(lead.phone)}
      onClose={onClose}
    >
      <div className="modal-content v6-call-modal">
        <div className="v6-call-tabs">
          <button
            className={mode === "phone" ? "active" : ""}
            onClick={() => setMode("phone")}
          >
            <Phone size={16} />
            Telefonla ara
          </button>
          <button
            className={mode === "ai" ? "active" : ""}
            onClick={() => setMode("ai")}
          >
            <Sparkles size={16} />
            Yapay zekâ araması
          </button>
        </div>
        {mode === "phone" ? (
          <>
            {!demo && <PbxCallBox leadId={leadId} onDone={onClose} />}
            <p>
              Bilgisayarınızdaki veya telefonunuzdaki arama uygulaması açılır.
              CRM içinden sesli görüşme için SIP/PBX ağ geçidinin bağlanması
              gerekir.
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
              Bu seçenek CRM’de başarılı arama sonucu üretmez; sonuç sağlayıcı
              webhookuyla gelir.
            </small>
          </>
        ) : (
          <>
            <VapiCallFields
              {...options}
              lineId={lineId}
              assistantId={assistant}
              onLine={setLineId}
              onAssistant={setAssistant}
              onReload={options.reload}
            />
            <div className="info-banner slim">
              <ShieldCheck size={16} />
              <p>
                {demo
                  ? "Demo modu hiçbir gerçek arama göndermez."
                  : "Seçili müşteriye gerçek AI araması başlatılır. Vapi kurulumu gereklidir; sağlayıcı ücretleri uygulanabilir."}
              </p>
            </div>
            <button
              disabled={
                busy ||
                !can ||
                (!demo &&
                  (options.loading ||
                    !canUseVapiSelection(options.catalog, lineId, assistant)))
              }
              className="btn primary"
              onClick={() => void call()}
            >
              <Phone size={16} />
              {busy
                ? "İletiliyor…"
                : demo
                  ? "Demo AI aramasını dene"
                  : "AI aramasını başlat"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

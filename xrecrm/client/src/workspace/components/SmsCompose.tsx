import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Modal } from "./ui";

let statusCache: { configured: boolean; sender: string } | null = null;

/** Müşteri kartındaki "SMS gönder" düğmesi ve yazma penceresi (Turkcell bağlantısı varsa etkin). */
export default function SmsCompose({ leadId, phone, name }: { leadId: string; phone: string; name: string }) {
  const { demo, user, request, refresh } = useStore();
  const [status, setStatus] = useState(statusCache);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (demo || !user || statusCache) return;
    request("/api/sms/status")
      .then((r) => {
        statusCache = { configured: Boolean(r.configured), sender: String(r.sender || "") };
        setStatus(statusCache);
      })
      .catch(() => undefined);
  }, [demo, user]);
  const ready = !demo && Boolean(status?.configured) && Boolean(phone);
  // Türkçe karakter içeren ileti 70, içermeyen 160 karakterlik parçalara bölünür.
  const unicode = /[^\u0000-\u007f]/.test(text);
  const parts = text.length ? Math.ceil(text.length / (unicode ? (text.length > 70 ? 67 : 70) : text.length > 160 ? 153 : 160)) : 0;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await request("/api/sms/send", { leadId, text });
      toast.success("SMS gönderildi.");
      setOpen(false);
      setText("");
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="em-drawer-action"
        disabled={!ready}
        onClick={() => setOpen(true)}
        title={
          demo
            ? "Demo modunda SMS gönderilmez"
            : !phone
              ? "Önce müşterinin telefon numarasını ekleyin"
              : status?.configured
                ? "Müşteriye SMS gönderin"
                : "Önce Entegrasyonlar sayfasından Turkcell SMS bağlantısını kurun"
        }
      >
        <Smartphone size={13} />
        SMS gönder
      </button>
      {open && (
        <Modal title="SMS gönder" subtitle={`${name} · ${phone}${status?.sender ? ` · gönderen: ${status.sender}` : ""}`} onClose={() => setOpen(false)}>
          <form onSubmit={send}>
            <div className="modal-content form-grid">
              <label className="full">
                Mesaj
                <textarea rows={5} required autoFocus maxLength={918} value={text} onChange={(e) => setText(e.target.value)} placeholder="Mesajınızı yazın…" />
                <small>
                  {text.length} karakter · {parts || 0} SMS{unicode ? " (Türkçe karakter içeriyor)" : ""}
                </small>
              </label>
            </div>
            <footer className="modal-footer">
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>
                Vazgeç
              </button>
              <button className="btn primary" disabled={busy || !text.trim()}>
                Gönder
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

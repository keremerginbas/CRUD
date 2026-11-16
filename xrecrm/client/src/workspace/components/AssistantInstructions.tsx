// Firmaya özel asistan talimatları: projeler, fiyatlar, üslup ve satış kuralları. Asistan her yanıtta dikkate alır.
import { useEffect, useState } from "react";
import { BookOpenText } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";

const EXAMPLE = `Örnek:
- Firmamız: … (ne satıyoruz, hangi şehirlerde)
- Projeler: A Projesi 2+1 3,5–4,2 milyon TL; B Projesi teslim Haziran 2027
- Müşteriye "siz" diye hitap et, kısa ve net yaz
- Fiyat sorulursa aralık ver, kesin fiyat için randevu öner
- Yeni müşteri 24 saat içinde aranmalı; aranmadıysa beni uyar`;

export default function AssistantInstructions() {
  const { demo, user, request } = useStore();
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [info, setInfo] = useState<{ canEdit: boolean; max: number; updatedAt: string | null; updatedBy: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (demo || !user) return;
    request("/api/assistant/instructions")
      .then((r: { text: string; canEdit: boolean; max: number; updatedAt: string | null; updatedBy: string | null }) => {
        setText(r.text);
        setSaved(r.text);
        setInfo(r);
      })
      .catch(() => setInfo(null));
  }, [demo, user?.openId]);
  if (demo || !info) return null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await request("/api/assistant/instructions", { text }, "PUT");
      setSaved(r.text);
      setText(r.text);
      setInfo({ ...info, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
      toast.success("Asistan talimatları kaydedildi. Sonraki sorudan itibaren geçerli.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel ai-context-card ai-instructions">
      <header>
        <BookOpenText size={18} />
        <strong>Asistan talimatları</strong>
      </header>
      <p>
        {info.canEdit
          ? "Asistanın her yanıtta bilmesini ve uymasını istediklerinizi yazın: projeler, fiyat aralıkları, üslup, satış kuralları."
          : "Yöneticinizin asistana verdiği kalıcı talimatlar. Yalnız çalışma alanı sahibi değiştirebilir."}
      </p>
      <textarea
        rows={9}
        value={text}
        readOnly={!info.canEdit}
        maxLength={info.max}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        aria-label="Asistan talimatları"
      />
      {info.canEdit && (
        <div className="ai-instructions-foot">
          <small>
            {text.length} / {info.max} · Şifre ve anahtar yazmayın
          </small>
          <button type="button" className="btn primary" disabled={busy || text.trim() === saved.trim()} onClick={save}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      )}
      {info.updatedAt && (
        <small className="ai-instructions-meta">
          Son güncelleme: {new Date(info.updatedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}
          {info.updatedBy ? ` · ${info.updatedBy}` : ""}
        </small>
      )}
    </section>
  );
}

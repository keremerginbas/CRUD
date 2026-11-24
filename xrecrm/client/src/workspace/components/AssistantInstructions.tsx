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

const ANALYSIS_EXAMPLE = `Örnek:
- Temsilci ilk 10 saniyede adını ve firmayı söylemeli (söylemediyse 15 puan düş)
- Müşterinin bütçesi, kaç oda istediği ve ne zaman almayı düşündüğü mutlaka sorulmalı
- Görüşme randevu ya da ofis daveti ile bitmeli; teklif edilmediyse belirt
- Fiyat telefonda kesin söylenmemeli, aralık verilmeli
- Müşteri ilgisizse nedenini yaz (fiyat, konum, zamanlama)`;

interface Props {
  variant?: "assistant" | "analysis";
}
const VARIANTS = {
  assistant: {
    path: "/api/assistant/instructions",
    title: "Asistan talimatları",
    edit: "Asistanın her yanıtta bilmesini ve uymasını istediklerinizi yazın: projeler, fiyat aralıkları, üslup, satış kuralları.",
    view: "Yöneticinizin asistana verdiği kalıcı talimatlar. Yalnız çalışma alanı sahibi değiştirebilir.",
    saved: "Asistan talimatları kaydedildi. Sonraki sorudan itibaren geçerli.",
    example: EXAMPLE,
    rows: 9,
  },
  analysis: {
    path: "/api/assistant/analysis-instructions",
    title: "Görüşme analiz senaryosu",
    edit: "Telefon görüşmeleri ve yazışmalar neye göre değerlendirilsin, puan neye göre verilsin? Kendi ölçütlerinizi yazın; boş bırakırsanız standart değerlendirme yapılır.",
    view: "Yöneticinizin belirlediği görüşme değerlendirme ölçütleri. Yalnız çalışma alanı sahibi değiştirebilir.",
    saved: "Analiz senaryosu kaydedildi. Bundan sonraki görüşmelerde geçerli.",
    example: ANALYSIS_EXAMPLE,
    rows: 8,
  },
};

export default function AssistantInstructions({ variant = "assistant" }: Props) {
  const v = VARIANTS[variant];
  const { demo, user, request } = useStore();
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [info, setInfo] = useState<{ canEdit: boolean; max: number; updatedAt: string | null; updatedBy: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (demo || !user) return;
    request(v.path)
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
      const r = await request(v.path, { text }, "PUT");
      setSaved(r.text);
      setText(r.text);
      setInfo({ ...info, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
      toast.success(v.saved);
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
        <strong>{v.title}</strong>
      </header>
      <p>
        {info.canEdit
          ? v.edit
          : v.view}
      </p>
      <textarea
        rows={v.rows}
        value={text}
        readOnly={!info.canEdit}
        maxLength={info.max}
        onChange={(e) => setText(e.target.value)}
        placeholder={v.example}
        aria-label={v.title}
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

import {
  Sparkles,
  CalendarDays,
  ArrowUpRight,
  Workflow,
  Users,
  CheckSquare,
  BarChart3,
  ShieldCheck,
  Download,
} from "lucide-react";
import { useStore } from "../store";
import {
  useAssistant,
  ChatSurface,
  downloadAIReport,
  todayTurkey,
} from "../components/Assistant";
import { Badge } from "../components/ui";
import { money } from "../data";
export default function AI({
  navigate,
  onLead,
}: {
  navigate: (p: string) => void;
  onLead: (id: string) => void;
}) {
  const { data, demo } = useStore();
  const ai = useAssistant();
  const latest = [...ai.items].reverse().find((x) => x.report);
  return (
    <>
      <div className="b24-page-head ai-page-heading">
        <div>
          <span className="ai-eyebrow">XRE INTELLIGENCE</span>
          <h1>CRM’nize sor. Sonraki adımı birlikte atın.</h1>
          <p>
            Satış bağlamınızı bilen asistanınız: raporlar, müşteri takibi ve
            günlük işler.
          </p>
        </div>
        <Badge tone={demo ? "amber" : ai.status.configured ? "green" : "gray"}>
          {demo
            ? "Demo asistan"
            : ai.status.configured
              ? "OpenAI yapılandırıldı"
              : "AI kurulumu gerekli"}
        </Badge>
      </div>
      <div className="ai-center-layout">
        <div className="ai-center-main">
          <ChatSurface full navigate={navigate} onLead={onLead} />
        </div>
        <aside className="ai-center-sidebar">
          <section className="panel ai-context-card">
            <header>
              <Sparkles size={18} />
              <strong>Ortak CRM bağlamı</strong>
            </header>
            <p>Asistan yalnız bu çalışma alanının verilerini kullanır.</p>
            <div>
              <span>Müşteriler</span>
              <b>{data.leads.length}</b>
            </div>
            <div>
              <span>Aktif fırsat tutarı</span>
              <b>
                {money(
                  data.leads
                    .filter((l) => !["won", "lost"].includes(l.stage))
                    .reduce((a, l) => a + l.value, 0),
                )}
              </b>
            </div>
            <div>
              <span>Açık görevler</span>
              <b>{data.tasks.filter((t) => t.status !== "done").length}</b>
            </div>
            <div>
              <span>İletişim kayıtları</span>
              <b>{data.messages.length + data.calls.length}</b>
            </div>
            <div>
              <span>Etkin otomasyonlar</span>
              <b>{data.rules.filter((r) => r.enabled).length}</b>
            </div>
            <footer>
              <ShieldCheck size={13} />
              {demo
                ? "Demo yanıtları dış modele gönderilmez."
                : "Anahtarlar tarayıcıya aktarılmaz."}
            </footer>
          </section>
          <section className="panel ai-shortcuts">
            <header>
              <CalendarDays size={18} />
              <strong>Rapor & analiz</strong>
            </header>
            <button
              disabled={ai.busy}
              onClick={() =>
                ai.send(
                  "Seçili dönem için günlük CRM raporunu hazırla; özet, riskler ve öncelikli işleri sırala.",
                  true,
                )
              }
            >
              <span>
                <strong>Dönem raporu</strong>
                <small>
                  {ai.from} → {ai.to}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button
              disabled={ai.busy}
              onClick={() =>
                ai.send(
                  "Gecikmiş görevleri ve takvim etkinliklerini analiz et, önceliklendir.",
                )
              }
            >
              <span>
                <strong>Takip riskleri</strong>
                <small>Gecikmiş ve açık işler</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button
              disabled={ai.busy}
              onClick={() =>
                ai.send(
                  "CRM satış hunisini analiz et; aşama ve sorumlu bazında darboğazları ve önerileri ver.",
                )
              }
            >
              <span>
                <strong>Satış hunisi analizi</strong>
                <small>Fırsatlar ve danışmanlar</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            {latest && (
              <button onClick={() => downloadAIReport(latest)}>
                <span>
                  <strong>Son raporu indir</strong>
                  <small>Markdown · veriye dayalı analiz</small>
                </span>
                <Download size={15} />
              </button>
            )}
          </section>
          <section className="panel ai-shortcuts">
            <header>
              <CheckSquare size={18} />
              <strong>Bir işi hazırlayın</strong>
            </header>
            {[
              [
                "Görev oluştur",
                "Takip görevi oluşturmak istiyorum. Gerekli müşteri, sorumlu ve tarih bilgisini sor.",
              ],
              ["Müşteri bul", "Müşteri aramak istiyorum. Kimi aradığımı sor."],
              [
                "Mesaj taslağı",
                "Seçili müşteri için WhatsApp takip mesajı taslağı hazırla.",
              ],
              [
                "Otomasyon tasarla",
                "Yeni statü otomasyonu tasarlayalım; hedef aşama ve yapılacak işlemi sor.",
              ],
            ].map(([label, text]) => (
              <button
                key={label}
                disabled={ai.busy}
                onClick={() => ai.send(text)}
              >
                <span>{label}</span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </section>
          <p className="ai-sidebar-note">
            Asistan öneri ve işlem kartı üretir. Mesaj gönderimi, arama veya
            statü değişimi kartı inceledikten sonra uygulanır.
          </p>
        </aside>
      </div>
    </>
  );
}

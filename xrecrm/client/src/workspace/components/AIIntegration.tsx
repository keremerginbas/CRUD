import { Sparkles, Workflow, ArrowUpRight, ShieldCheck } from "lucide-react";
import { useStore } from "../store";
import { useAssistant } from "./Assistant";
import { Badge } from "./ui";
export default function AIIntegration() {
  const { demo } = useStore();
  const ai = useAssistant();
  const go = (path: string) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return (
    <div className="ai-integration-links">
      <section>
        <span>
          <Sparkles size={22} />
        </span>
        <div>
          <h3>CRM yapay zekâ asistanı</h3>
          <p>
            Günlük rapor analizi, müşteri bağlamı ve uygulanabilir CRM
            önerileri. Anahtar yalnız sunucu ortamında.
          </p>
          <Badge
            tone={demo ? "amber" : ai.status.configured ? "green" : "gray"}
          >
            {demo
              ? "Demo"
              : "OpenAI " +
                (ai.status.configured ? "yapılandırıldı" : "kurulumu gerekli")}
          </Badge>
        </div>
        <button className="btn secondary" onClick={() => go("/ai")}>
          Asistan merkezi
          <ArrowUpRight size={14} />
        </button>
      </section>
      <section>
        <span>
          <Workflow size={22} />
        </span>
        <div>
          <h3>n8n bağlantı yönetimi</h3>
          <p>
            Güvenli API erişimi, iş akışları ve statü bazlı çift yönlü webhook
            köprüsü.
          </p>
          <small>
            <ShieldCheck size={12} /> API anahtarı ve webhook tokenı birbirinden
            ayrıdır.
          </small>
        </div>
        <button className="btn secondary" onClick={() => go("/n8n")}>
          n8n’yi yönet
          <ArrowUpRight size={14} />
        </button>
      </section>
    </div>
  );
}

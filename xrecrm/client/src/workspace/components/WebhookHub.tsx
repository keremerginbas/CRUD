import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Download,
  Eye,
  KeyRound,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Empty, Modal, Toggle } from "./ui";
import {
  INBOUND_ACTIONS,
  OUTBOUND_EVENTS,
  inboundUrl,
  type InboundAction,
  type InboundHookView,
  type OutboundEvent,
  type OutboundHookView,
} from "../../../../shared/webhook-hub";
import {
  downloadEventReceiverTemplate,
  downloadLeadSenderTemplate,
} from "../n8n-templates";
import "../webhook-hub.css";

interface HubState {
  origin: string;
  inbound: InboundHookView[];
  outbound: OutboundHookView[];
  allowPrivateHosts: string[];
}

const demoStamp = new Date().toISOString();
const demoHub: HubState = {
  origin: "",
  allowPrivateHosts: [],
  inbound: [
    {
      id: "indemo01",
      name: "Web sitesi formu",
      actions: ["lead.create", "lead.find"],
      enabled: true,
      tokenPreview: "Xk3p…9fQa",
      createdAt: demoStamp,
      updatedAt: demoStamp,
      lastUsedAt: demoStamp,
      useCount: 42,
    },
    {
      id: "indemo02",
      name: "Santral (Asterisk) CDR",
      actions: ["call.log"],
      enabled: true,
      tokenPreview: "b81Q…tT2m",
      createdAt: demoStamp,
      updatedAt: demoStamp,
      useCount: 0,
    },
  ],
  outbound: [
    {
      id: "outdemo1",
      name: "n8n · Satış bildirimleri",
      url: "https://n8n.example.com/webhook/xre-crm-events",
      events: ["lead.created", "lead.stage_changed", "call.missed"],
      enabled: true,
      skipInboundEcho: true,
      headers: [],
      secretPreview: "3fa1…c09e",
      createdAt: demoStamp,
      updatedAt: demoStamp,
      lastDeliveryAt: demoStamp,
      lastStatus: 200,
      successCount: 128,
      failureCount: 2,
    },
  ],
};

const actionLabel = Object.fromEntries(INBOUND_ACTIONS.map((a) => [a.id, a.label]));
const eventLabel = Object.fromEntries(OUTBOUND_EVENTS.map((e) => [e.id, e.label]));
const eventGroups = [...new Set(OUTBOUND_EVENTS.map((e) => e.group))];

const sampleBodies: Record<InboundAction, Record<string, unknown>> = {
  "lead.create": { name: "Ayşe Demir", phone: "05550000000", email: "ayse@example.com", source: "Web formu", city: "İstanbul" },
  "lead.update": { phone: "05550000000", fields: { city: "Ankara", value: 2500000 } },
  "lead.stage": { phone: "05550000000", stage: "qualified", appointmentAt: "2026-10-20T14:00:00+03:00" },
  "lead.find": { phone: "05550000000" },
  "note.add": { phone: "05550000000", text: "Müşteri hafta sonu dönüş istedi." },
  "task.create": { phone: "05550000000", title: "Geri ara", dueAt: "2026-10-14T10:00:00+03:00", priority: "high" },
  "activity.create": { phone: "05550000000", type: "meeting", title: "Ofis görüşmesi", startAt: "2026-10-15T11:00:00+03:00" },
  "call.log": { phone: "05550000000", direction: "inbound", status: "no-answer", line: "02120000000", callId: "1697200000.42", durationSeconds: 0, agent: "Dahili 101" },
  "message.log": { phone: "05550000000", direction: "inbound", channel: "sms", text: "Merhaba, fiyat bilgisi alabilir miyim?" },
};

function curl(url: string, action: InboundAction) {
  return `curl -X POST '${url}/${action}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(sampleBodies[action])}'`;
}

const copy = (text: string) =>
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Panoya kopyalandı."))
    .catch(() => toast.error("Panoya erişilemiyor."));

type OutboundDraft = {
  id?: string;
  name: string;
  url: string;
  events: OutboundEvent[];
  skipInboundEcho: boolean;
  headers: { name: string; value: string; existing?: boolean }[];
};

export default function WebhookHub() {
  const { demo, user, request } = useStore();
  const [hub, setHub] = useState<HubState>(demoHub);
  const [loading, setLoading] = useState(false);
  const [inboundDraft, setInboundDraft] = useState<{ name: string; actions: InboundAction[] } | null>(null);
  const [outboundDraft, setOutboundDraft] = useState<OutboundDraft | null>(null);
  const [reveal, setReveal] = useState<{ title: string; hook?: InboundHookView; token?: string; secret?: string } | null>(null);
  const [example, setExample] = useState<{ hook: InboundHookView; action: InboundAction } | null>(null);
  const [busy, setBusy] = useState("");
  const origin = hub.origin || window.location.origin;
  const live = !demo && Boolean(user);

  async function load() {
    if (!live) {
      setHub(demoHub);
      return;
    }
    setLoading(true);
    try {
      setHub(await request("/api/webhook-hub"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [live]);

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (!live) {
      toast.info("Demo modunda webhook oluşturulmaz. Canlı moda geçin.");
      return undefined;
    }
    setBusy(key);
    try {
      const result = await fn();
      await load();
      return result;
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    } finally {
      setBusy("");
    }
  }

  const saveInbound = async () => {
    if (!inboundDraft) return;
    const r = await run("in-new", () => request("/api/webhook-hub/inbound", inboundDraft));
    if (r) {
      setInboundDraft(null);
      setReveal({ title: "Gelen webhook oluşturuldu", hook: r.hook, token: r.token });
    }
  };

  const saveOutbound = async () => {
    if (!outboundDraft) return;
    const { id, ...draft } = outboundDraft;
    const body = {
      ...draft,
      headers: draft.headers
        .filter((h) => h.name.trim())
        .map((h) => ({ name: h.name.trim(), value: h.value })),
    };
    const r = await run("out-save", () =>
      id
        ? request(`/api/webhook-hub/outbound/${id}`, body, "PATCH")
        : request("/api/webhook-hub/outbound", body),
    );
    if (r) {
      setOutboundDraft(null);
      if (r.secret)
        setReveal({ title: "Giden webhook oluşturuldu", secret: r.secret });
      else toast.success("Giden webhook güncellendi.");
    }
  };

  const testOutbound = async (hook: OutboundHookView) => {
    const r = await run(`test-${hook.id}`, () =>
      request(`/api/webhook-hub/outbound/${hook.id}/test`, {}),
    );
    if (!r) return;
    if (r.ok) toast.success(`Test teslim edildi · HTTP ${r.status} · ${r.durationMs} ms`);
    else toast.error(`Test başarısız: ${r.error || `HTTP ${r.status}`}`);
  };

  const outboundGrouped = useMemo(
    () =>
      eventGroups.map((group) => ({
        group,
        events: OUTBOUND_EVENTS.filter((e) => e.group === group),
      })),
    [],
  );

  return (
    <div className="wh-hub">
      <div className="wh-head">
        <div>
          <h3>Webhook merkezi</h3>
          <p>
            Bitrix24'teki gelen/giden webhook mantığı: dış sistemler CRM'e yazar,
            CRM olayları anında n8n ve diğer uygulamalara gider.
          </p>
        </div>
        <div className="wh-head-actions">
          <button className="btn secondary small" onClick={downloadEventReceiverTemplate}>
            <Download size={14} /> n8n olay alıcı şablonu
          </button>
          <button
            className="btn secondary small"
            onClick={() =>
              downloadLeadSenderTemplate(
                hub.inbound[0] ? inboundUrl(origin, hub.inbound[0]) : "",
              )
            }
          >
            <Download size={14} /> n8n müşteri gönder şablonu
          </button>
          <button className="icon-button" onClick={() => void load()} aria-label="Webhookları yenile">
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>
      {!live && (
        <p className="wh-note">
          Örnek görünüm. Gerçek webhook adresleri canlı modda, yetkili oturumla oluşturulur.
        </p>
      )}

      <section className="panel wh-section">
        <header>
          <span className="rule-icon blue"><ArrowDownLeft size={20} /></span>
          <div>
            <h4>Gelen webhooklar</h4>
            <p>Her bağlantının kendi adresi, anahtarı ve izinli işlemleri vardır.</p>
          </div>
          <button
            className="btn primary small"
            onClick={() => setInboundDraft({ name: "", actions: ["lead.create"] })}
          >
            <Plus size={15} /> Gelen webhook
          </button>
        </header>
        {hub.inbound.length ? (
          <div className="wh-list">
            {hub.inbound.map((hook) => (
              <article key={hook.id} className={`wh-item ${hook.enabled ? "" : "off"}`}>
                <div className="wh-item-main">
                  <strong>{hook.name}</strong>
                  <code className="wh-url">
                    {inboundUrl(origin, hook, hook.tokenPreview)}
                  </code>
                  <div className="wh-chips">
                    {hook.actions.map((a) => (
                      <button
                        key={a}
                        className="wh-chip"
                        title="Örnek isteği göster"
                        onClick={() => setExample({ hook, action: a })}
                      >
                        {actionLabel[a] || a}
                      </button>
                    ))}
                  </div>
                  <small>
                    {hook.useCount} çağrı
                    {hook.lastUsedAt &&
                      ` · son: ${new Date(hook.lastUsedAt).toLocaleString("tr-TR")}`}
                    {hook.lastError && <span className="wh-error"> · {hook.lastError}</span>}
                  </small>
                </div>
                <div className="wh-item-actions">
                  <Toggle
                    value={hook.enabled}
                    label={`${hook.name} etkin`}
                    onChange={() =>
                      void run(`in-${hook.id}`, () =>
                        request(`/api/webhook-hub/inbound/${hook.id}`, { enabled: !hook.enabled }, "PATCH"),
                      )
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label="Anahtarı yenile"
                    title="Anahtarı yenile (eski adres çalışmaz)"
                    disabled={busy === `rot-${hook.id}`}
                    onClick={async () => {
                      if (!confirm("Eski adres hemen geçersiz olur. Devam edilsin mi?")) return;
                      const r = await run(`rot-${hook.id}`, () =>
                        request(`/api/webhook-hub/inbound/${hook.id}/rotate`, {}),
                      );
                      if (r) setReveal({ title: "Yeni anahtar oluşturuldu", hook: r.hook, token: r.token });
                    }}
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Gelen webhooku sil"
                    onClick={() => {
                      if (confirm(`"${hook.name}" silinsin mi?`))
                        void run(`del-${hook.id}`, () =>
                          request(`/api/webhook-hub/inbound/${hook.id}`, {}, "DELETE"),
                        );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="Gelen webhook yok" description="Form, reklam, santral veya n8n için bir adres oluşturun." />
        )}
      </section>

      <section className="panel wh-section">
        <header>
          <span className="rule-icon green"><ArrowUpRight size={20} /></span>
          <div>
            <h4>Giden webhooklar</h4>
            <p>Seçtiğiniz CRM olayları imzalı olarak hedef adrese gönderilir; hata olursa yeniden denenir.</p>
          </div>
          <button
            className="btn primary small"
            onClick={() =>
              setOutboundDraft({
                name: "",
                url: "",
                events: ["lead.created", "lead.stage_changed"],
                skipInboundEcho: true,
                headers: [],
              })
            }
          >
            <Plus size={15} /> Giden webhook
          </button>
        </header>
        {hub.outbound.length ? (
          <div className="wh-list">
            {hub.outbound.map((hook) => (
              <article key={hook.id} className={`wh-item ${hook.enabled ? "" : "off"}`}>
                <div className="wh-item-main">
                  <strong>
                    {hook.name}{" "}
                    {hook.lastStatus !== undefined && (
                      <Badge tone={hook.lastStatus && hook.lastStatus < 300 ? "green" : "red"}>
                        {hook.lastStatus ? `HTTP ${hook.lastStatus}` : "Ulaşılamadı"}
                      </Badge>
                    )}
                  </strong>
                  <code className="wh-url">{hook.url}</code>
                  <div className="wh-chips">
                    {hook.events.map((e) => (
                      <span key={e} className="wh-chip static">{eventLabel[e] || e}</span>
                    ))}
                  </div>
                  <small>
                    {hook.successCount} başarılı · {hook.failureCount} hatalı
                    {hook.lastDeliveryAt &&
                      ` · son: ${new Date(hook.lastDeliveryAt).toLocaleString("tr-TR")}`}
                    {hook.lastError && <span className="wh-error"> · {hook.lastError}</span>}
                  </small>
                </div>
                <div className="wh-item-actions">
                  <Toggle
                    value={hook.enabled}
                    label={`${hook.name} etkin`}
                    onChange={() =>
                      void run(`out-${hook.id}`, () =>
                        request(`/api/webhook-hub/outbound/${hook.id}`, { enabled: !hook.enabled }, "PATCH"),
                      )
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label="Test olayı gönder"
                    title="Test olayı (ping) gönder"
                    disabled={busy === `test-${hook.id}`}
                    onClick={() => void testOutbound(hook)}
                  >
                    <Play size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="İmza anahtarını göster"
                    title="İmza anahtarını göster"
                    onClick={async () => {
                      const r = await run(`sec-${hook.id}`, () =>
                        request(`/api/webhook-hub/outbound/${hook.id}/secret`, {}),
                      );
                      if (r) setReveal({ title: `${hook.name} · imza anahtarı`, secret: r.secret });
                    }}
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Giden webhooku düzenle"
                    onClick={() =>
                      setOutboundDraft({
                        id: hook.id,
                        name: hook.name,
                        url: hook.url,
                        events: hook.events,
                        skipInboundEcho: hook.skipInboundEcho,
                        headers: hook.headers.map((h) => ({ name: h.name, value: "", existing: true })),
                      })
                    }
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Giden webhooku sil"
                    onClick={() => {
                      if (confirm(`"${hook.name}" silinsin mi?`))
                        void run(`del-${hook.id}`, () =>
                          request(`/api/webhook-hub/outbound/${hook.id}`, {}, "DELETE"),
                        );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="Giden webhook yok" description="n8n, Zapier/Make veya kendi uygulamanız için olay aboneliği ekleyin." />
        )}
        <details className="wh-docs">
          <summary>
            <ShieldCheck size={15} /> İmza doğrulama ve örnek gövde
          </summary>
          <p>
            Her istekte <code>X-XRE-Event</code>, <code>X-XRE-Delivery</code>,{" "}
            <code>X-XRE-Timestamp</code> ve <code>X-XRE-Signature</code> başlıkları bulunur.
            İmza: <code>sha256=HMAC_SHA256(gizli_anahtar, timestamp + "." + ham_gövde)</code>.
            2xx dışındaki yanıtlar (4xx hariç) üstel bekleme ile 5 kez denenir.
          </p>
          <pre>{`{
  "id": "dlv_123",
  "event": "lead.stage_changed",
  "occurredAt": "2026-10-13T10:15:00.000Z",
  "source": "xre-crm",
  "entity": { "kind": "lead", "id": "lead-…" },
  "data": { "id": "lead-…", "name": "Ayşe Demir", "phone": "905550000000", "stage": "qualified", … },
  "previous": { "stage": "contacted", "pipelineId": "sales" }
}`}</pre>
          {!!hub.allowPrivateHosts.length && (
            <p>İzinli iç ağ adresleri: {hub.allowPrivateHosts.join(", ")}</p>
          )}
          <p>
            Kendi sunucunuzdaki n8n'e (ör. <code>http://10.0.0.5:5678</code>) göndermek için
            sunucu <code>.env</code> dosyasına <code>OUTBOUND_ALLOW_PRIVATE_HOSTS=10.0.0.5</code> ekleyin.
          </p>
        </details>
      </section>

      {inboundDraft && (
        <Modal title="Yeni gelen webhook" subtitle="Dış sistemin CRM'de yapabileceği işlemleri seçin" onClose={() => setInboundDraft(null)}>
          <div className="modal-content">
            <div className="form-grid">
              <label className="full">
                Bağlantı adı
                <input
                  autoFocus
                  value={inboundDraft.name}
                  placeholder="Örn. Web sitesi formu, Asterisk CDR, Meta Lead Ads"
                  onChange={(e) => setInboundDraft({ ...inboundDraft, name: e.target.value })}
                />
              </label>
            </div>
            <div className="wh-checks">
              {INBOUND_ACTIONS.map((a) => (
                <label key={a.id} className="wh-check">
                  <input
                    type="checkbox"
                    checked={inboundDraft.actions.includes(a.id)}
                    onChange={(e) =>
                      setInboundDraft({
                        ...inboundDraft,
                        actions: e.target.checked
                          ? [...inboundDraft.actions, a.id]
                          : inboundDraft.actions.filter((x) => x !== a.id),
                      })
                    }
                  />
                  <span>
                    <strong>{a.label}</strong> <code>{a.id}</code>
                    <small>{a.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setInboundDraft(null)}>Vazgeç</button>
            <button
              className="btn primary"
              disabled={!inboundDraft.name.trim() || !inboundDraft.actions.length || busy === "in-new"}
              onClick={() => void saveInbound()}
            >
              <Webhook size={16} /> Oluştur
            </button>
          </footer>
        </Modal>
      )}

      {outboundDraft && (
        <Modal
          title={outboundDraft.id ? "Giden webhooku düzenle" : "Yeni giden webhook"}
          subtitle="Hangi olaylar hangi adrese gitsin?"
          onClose={() => setOutboundDraft(null)}
          wide
        >
          <div className="modal-content">
            <div className="form-grid">
              <label>
                Ad
                <input
                  autoFocus
                  value={outboundDraft.name}
                  placeholder="Örn. n8n satış akışı"
                  onChange={(e) => setOutboundDraft({ ...outboundDraft, name: e.target.value })}
                />
              </label>
              <label>
                Hedef URL
                <input
                  value={outboundDraft.url}
                  placeholder="https://n8n.alanadiniz.com/webhook/xre-crm-events"
                  onChange={(e) => setOutboundDraft({ ...outboundDraft, url: e.target.value })}
                />
              </label>
            </div>
            {outboundGrouped.map(({ group, events }) => (
              <fieldset key={group} className="wh-fieldset">
                <legend>{group}</legend>
                {events.map((ev) => (
                  <label key={ev.id} className="wh-check inline">
                    <input
                      type="checkbox"
                      checked={outboundDraft.events.includes(ev.id)}
                      onChange={(e) =>
                        setOutboundDraft({
                          ...outboundDraft,
                          events: e.target.checked
                            ? [...outboundDraft.events, ev.id]
                            : outboundDraft.events.filter((x) => x !== ev.id),
                        })
                      }
                    />
                    <span>{ev.label} <code>{ev.id}</code></span>
                  </label>
                ))}
              </fieldset>
            ))}
            <fieldset className="wh-fieldset">
              <legend>Ek HTTP başlıkları (n8n Header Auth vb.)</legend>
              {outboundDraft.headers.map((h, i) => (
                <div className="wh-header-row" key={i}>
                  <input
                    aria-label="Başlık adı"
                    placeholder="X-N8N-Key"
                    value={h.name}
                    onChange={(e) => {
                      const headers = [...outboundDraft.headers];
                      headers[i] = { ...h, name: e.target.value };
                      setOutboundDraft({ ...outboundDraft, headers });
                    }}
                  />
                  <input
                    aria-label="Başlık değeri"
                    type="password"
                    placeholder={h.existing ? "Değişmeyecekse boş bırakın" : "Değer"}
                    value={h.value}
                    onChange={(e) => {
                      const headers = [...outboundDraft.headers];
                      headers[i] = { ...h, value: e.target.value };
                      setOutboundDraft({ ...outboundDraft, headers });
                    }}
                  />
                  <button
                    className="icon-button"
                    aria-label="Başlığı kaldır"
                    onClick={() =>
                      setOutboundDraft({
                        ...outboundDraft,
                        headers: outboundDraft.headers.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {outboundDraft.headers.length < 5 && (
                <button
                  className="text-button"
                  onClick={() =>
                    setOutboundDraft({
                      ...outboundDraft,
                      headers: [...outboundDraft.headers, { name: "", value: "" }],
                    })
                  }
                >
                  <Plus size={14} /> Başlık ekle
                </button>
              )}
            </fieldset>
            <label className="wh-check inline">
              <input
                type="checkbox"
                checked={outboundDraft.skipInboundEcho}
                onChange={(e) => setOutboundDraft({ ...outboundDraft, skipInboundEcho: e.target.checked })}
              />
              <span>Gelen webhooklardan doğan değişiklikleri gönderme (n8n döngüsünü önler)</span>
            </label>
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setOutboundDraft(null)}>Vazgeç</button>
            <button
              className="btn primary"
              disabled={!outboundDraft.name.trim() || !outboundDraft.url.trim() || !outboundDraft.events.length || busy === "out-save"}
              onClick={() => void saveOutbound()}
            >
              Kaydet
            </button>
          </footer>
        </Modal>
      )}

      {reveal && (
        <Modal title={reveal.title} subtitle="Bu değer yalnız şimdi tam olarak gösterilir" onClose={() => setReveal(null)}>
          <div className="modal-content">
            {reveal.hook && reveal.token && (
              <>
                <h4 className="setup-heading">Webhook adresi</h4>
                <div className="code-line">
                  <code>{inboundUrl(origin, reveal.hook, reveal.token)}</code>
                  <button className="icon-button" aria-label="Adresi kopyala" onClick={() => copy(inboundUrl(origin, reveal.hook!, reveal.token))}>
                    <Copy size={16} />
                  </button>
                </div>
                <p className="setup-footnote">
                  İşlemi adresin sonuna ekleyin (<code>/lead.create</code>) veya gövdede{" "}
                  <code>"action"</code> alanıyla gönderin. Aynı isteği tekrar işlememek için{" "}
                  <code>X-Idempotency-Key</code> başlığı kullanın.
                </p>
                <pre className="wh-pre">{curl(inboundUrl(origin, reveal.hook, reveal.token), reveal.hook.actions[0])}</pre>
              </>
            )}
            {reveal.secret && (
              <>
                <h4 className="setup-heading">İmza anahtarı (secret)</h4>
                <div className="code-line">
                  <code>{reveal.secret}</code>
                  <button className="icon-button" aria-label="Anahtarı kopyala" onClick={() => copy(reveal.secret!)}>
                    <Copy size={16} />
                  </button>
                </div>
                <p className="setup-footnote">
                  n8n şablonunda <code>XRE_WEBHOOK_SECRET</code> ortam değişkeni olarak kullanın.
                </p>
              </>
            )}
          </div>
          <footer className="modal-footer">
            <button className="btn primary" onClick={() => setReveal(null)}>Tamam, kaydettim</button>
          </footer>
        </Modal>
      )}

      {example && (
        <Modal title={`${actionLabel[example.action]} · örnek istek`} subtitle={example.hook.name} onClose={() => setExample(null)} wide>
          <div className="modal-content">
            <p className="setup-footnote">
              Anahtar güvenlik nedeniyle gizlidir; adresi oluştururken kopyaladığınız tam anahtarı kullanın.
            </p>
            <pre className="wh-pre">{curl(inboundUrl(origin, example.hook), example.action)}</pre>
            <button className="btn secondary small" onClick={() => copy(curl(inboundUrl(origin, example.hook), example.action))}>
              <Copy size={14} /> Kopyala
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

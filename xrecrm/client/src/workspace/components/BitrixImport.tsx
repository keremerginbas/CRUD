import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DatabaseZap, Eye, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Empty } from "./ui";
import {
  BITRIX_ENTITY_LABELS,
  BITRIX_IMPORT_ENTITIES,
  XRE_STAGES,
  XRE_STAGE_LABELS,
  type BitrixImportEntity,
  type BitrixImportJobView,
  type BitrixPreview,
  type XreStage,
} from "../../../../shared/bitrix-import";
import "../bitrix-import.css";

const statusLabel: Record<string, { text: string; tone: string }> = {
  running: { text: "Çalışıyor", tone: "blue" },
  completed: { text: "Tamamlandı", tone: "green" },
  failed: { text: "Hata", tone: "red" },
  cancelled: { text: "İptal edildi", tone: "amber" },
};

const semanticsLabel: Record<string, string> = {
  S: "Başarılı",
  F: "Başarısız",
  P: "Süreç",
};

export default function BitrixImport() {
  const { demo, user, request } = useStore();
  const live = !demo && Boolean(user);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [since, setSince] = useState("");
  const [preview, setPreview] = useState<BitrixPreview | null>(null);
  const [stageMap, setStageMap] = useState<Record<string, XreStage>>({});
  const [selected, setSelected] = useState<BitrixImportEntity[]>([...BITRIX_IMPORT_ENTITIES]);
  const [job, setJob] = useState<BitrixImportJobView | null>(null);
  const [busy, setBusy] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = job?.status === "running";

  async function loadStatus() {
    if (!live) return;
    try {
      const data = await request("/api/bitrix-import/status");
      setJob(data?.id ? (data as BitrixImportJobView) : null);
    } catch {
      /* Durum okunamazsa sessizce bir sonraki turu bekle. */
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [live]);

  useEffect(() => {
    if (!running) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    timer.current = setInterval(() => void loadStatus(), 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [running]);

  const sinceIso = since ? new Date(`${since}T00:00:00`).toISOString() : undefined;
  const body = () => ({
    ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
    ...(sinceIso ? { since: sinceIso } : {}),
  });

  async function runPreview() {
    if (!live) return;
    setBusy("preview");
    try {
      const data = (await request("/api/bitrix-import/preview", body())) as BitrixPreview;
      setPreview(data);
      setStageMap(data.stageMap || {});
      setSelected(
        BITRIX_IMPORT_ENTITIES.filter((entity) => data.counts?.[entity] !== null && data.counts?.[entity] !== undefined),
      );
      toast.success("Bitrix24 bağlantısı doğrulandı.");
    } catch (e) {
      setPreview(null);
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!live || !selected.length) return;
    setBusy("start");
    try {
      await request("/api/bitrix-import/start", { ...body(), entities: selected, stageMap });
      toast.success("Aktarım başlatıldı.");
      await loadStatus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function cancel() {
    if (!live) return;
    setBusy("cancel");
    try {
      await request("/api/bitrix-import/cancel", {});
      toast.info("İptal istendi; mevcut sayfa bitince durur.");
      await loadStatus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const toggle = (entity: BitrixImportEntity) =>
    setSelected((list) => (list.includes(entity) ? list.filter((x) => x !== entity) : [...list, entity]));

  const groups = useMemo(() => {
    const out = new Map<string, BitrixPreview["stages"]>();
    for (const stage of preview?.stages || []) {
      if (!out.has(stage.group)) out.set(stage.group, []);
      out.get(stage.group)!.push(stage);
    }
    return [...out.entries()];
  }, [preview]);

  const stageRelevant = selected.includes("leads") || selected.includes("deals");

  return (
    <section className="panel bxi" aria-label="Bitrix24 veri aktarımı">
      <header className="bxi-head">
        <span className="rule-icon blue">
          <DatabaseZap size={20} />
        </span>
        <div>
          <h4>Bitrix24'ten veri aktarımı</h4>
          <p>
            Lead, anlaşma, kişi, şirket, aktivite ve arama kayıtlarını XRE CRM'e taşıyın. Tekrar çalıştırmak
            mevcut Bitrix kayıtlarını günceller; hiçbir kayıt silinmez.
          </p>
        </div>
        {job && <Badge tone={statusLabel[job.status]?.tone}>{statusLabel[job.status]?.text || job.status}</Badge>}
      </header>

      {!live && (
        <p className="bxi-note">
          Demo modunda Bitrix24 aktarımı yapılamaz. Canlı moda geçip yetkili bir oturumla giriş yapın.
        </p>
      )}

      <div className="bxi-row">
        <label className="bxi-field">
          Bitrix24 gelen webhook adresi
          <input
            type="url"
            value={webhookUrl}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://firmaniz.bitrix24.com.tr/rest/1/abcdef123456/"
            onChange={(e) => setWebhookUrl(e.target.value)}
            disabled={!live}
          />
        </label>
        <label className="bxi-field narrow">
          Bu tarihten sonra değişenler
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} disabled={!live} />
        </label>
        <button className="btn secondary" onClick={() => void runPreview()} disabled={!live || busy !== "" || running}>
          <Eye size={15} /> {busy === "preview" ? "Kontrol ediliyor…" : "Önizle"}
        </button>
      </div>

      <details className="bxi-help">
        <summary>Gelen webhook nasıl oluşturulur?</summary>
        <ol>
          <li>
            Bitrix24'te <strong>Geliştirici kaynakları → Diğer → Gelen webhook</strong> menüsünü açın.
          </li>
          <li>
            İzinlerden <code>crm</code>, <code>user</code> ve <code>telephony</code> kapsamlarını seçip kaydedin.
          </li>
          <li>
            Oluşan <code>https://…/rest/&lt;kullanıcı&gt;/&lt;anahtar&gt;/</code> adresini buraya yapıştırın. Alanı boş
            bırakırsanız sunucudaki <code>BITRIX_WEBHOOK</code> ayarı kullanılır.
          </li>
          <li>Adres gizli anahtar içerir; yalnızca aktarım sırasında kullanılır ve yanıtlarda maskelenir.</li>
        </ol>
      </details>

      {preview ? (
        <>
          <div>
            <p className="bxi-help">
              Bağlantı: <code>{preview.webhook}</code>
              {preview.userCount !== null && ` · ${preview.userCount} kullanıcı`}
            </p>
          </div>
          <div className="bxi-counts">
            {BITRIX_IMPORT_ENTITIES.map((entity) => {
              const count = preview.counts?.[entity];
              const unavailable = count === null || count === undefined;
              const on = selected.includes(entity);
              return (
                <label key={entity} className={`bxi-count ${on ? "" : "off"}`}>
                  <span>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!live || running}
                      onChange={() => toggle(entity)}
                    />
                    {BITRIX_ENTITY_LABELS[entity]}
                  </span>
                  <strong>{unavailable ? "—" : count.toLocaleString("tr-TR")}</strong>
                </label>
              );
            })}
          </div>
          {preview.warnings?.length > 0 && (
            <ul className="bxi-warn">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {stageRelevant && groups.length > 0 && (
            <div className="bxi-table-wrap">
              <table className="bxi-table">
                <thead>
                  <tr>
                    <th>Bitrix aşaması</th>
                    <th>Tür</th>
                    <th>XRE aşaması</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([group, stages]) => (
                    <Fragment key={group}>
                      <tr className="group">
                        <td colSpan={3}>{group}</td>
                      </tr>
                      {stages.map((stage) => (
                        <tr key={stage.key}>
                          <td>
                            {stage.name} <small className="muted">({stage.statusId})</small>
                          </td>
                          <td>
                            <Badge tone={stage.semantics === "S" ? "green" : stage.semantics === "F" ? "red" : "gray"}>
                              {semanticsLabel[stage.semantics]}
                            </Badge>
                          </td>
                          <td>
                            <select
                              aria-label={`${stage.name} için XRE aşaması`}
                              value={stageMap[stage.key] || stage.suggested}
                              disabled={!live || running}
                              onChange={(e) =>
                                setStageMap((map) => ({ ...map, [stage.key]: e.target.value as XreStage }))
                              }
                            >
                              {XRE_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {XRE_STAGE_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="bxi-row">
            <button
              className="btn primary"
              onClick={() => void start()}
              disabled={!live || running || busy !== "" || !selected.length}
            >
              <Play size={15} /> {busy === "start" ? "Başlatılıyor…" : "Aktarımı başlat"}
            </button>
          </div>
        </>
      ) : (
        !job && (
          <Empty
            title="Önizleme bekleniyor"
            description="Webhook adresini girip Önizle'ye basın; kayıt sayıları ve aşama eşlemesi burada görünür."
          />
        )
      )}

      {job && (
        <div className="bxi-progress">
          <div className="bxi-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <small className="bxi-help">
              Başlangıç: {new Date(job.startedAt).toLocaleString("tr-TR")}
              {job.finishedAt && ` · Bitiş: ${new Date(job.finishedAt).toLocaleString("tr-TR")}`}
            </small>
            {running && (
              <button className="btn secondary small" onClick={() => void cancel()} disabled={!live || busy === "cancel"}>
                <Square size={13} /> İptal et
              </button>
            )}
          </div>
          {BITRIX_IMPORT_ENTITIES.filter((entity) => job.entities[entity]).map((entity) => {
            const c = job.entities[entity]!;
            const done = c.imported + c.updated + c.failed;
            const pct = c.total ? Math.min(100, Math.round((done / c.total) * 100)) : job.status === "running" ? 0 : 100;
            return (
              <div key={entity} className="bxi-bar">
                <div>
                  <span>{BITRIX_ENTITY_LABELS[entity]}</span>
                  <small>
                    {done.toLocaleString("tr-TR")} / {c.total.toLocaleString("tr-TR")} · {c.imported} yeni · {c.updated}{" "}
                    güncellendi{c.failed ? ` · ${c.failed} hatalı` : ""}
                  </small>
                </div>
                <div
                  className="bxi-track"
                  role="progressbar"
                  aria-label={`${BITRIX_ENTITY_LABELS[entity]} ilerlemesi`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {job.errors.length > 0 && (
            <ul className="bxi-errors" aria-label="Aktarım hataları">
              {job.errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          )}
          {job.log.length > 0 && (
            <details className="bxi-help">
              <summary>İşlem günlüğü</summary>
              <pre className="bxi-log">{job.log.join("\n")}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

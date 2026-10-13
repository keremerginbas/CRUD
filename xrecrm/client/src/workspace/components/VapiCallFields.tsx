import { useEffect, useState } from "react";
import { useStore } from "../store";
import { formatPhone, lines, groupNames } from "../data";

export interface VapiOptions {
  keyConfigured: boolean;
  assistants: { id: string; name: string }[];
  lines: {
    lineId: string;
    phone: string;
    group: string;
    name: string;
    phoneNumberId: string;
    credentialConfigured: boolean;
    callable?: boolean;
    inboundAssistantId?: string;
    status?: string;
  }[];
  unavailableLineIds: string[];
  unmatchedNumbers: number;
  webhookConfigured: boolean;
  defaultAssistantId?: string;
  checkedAt: string;
}
export function useVapiOptions(enabled = true) {
  const { demo, user, request } = useStore();
  const [catalog, setCatalog] = useState<VapiOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalog(null);
    setError("");
    setLoading(false);
    if (!enabled || demo || !user) return;
    setLoading(true);
    request("/api/calls/options")
      .then((result: VapiOptions) => {
        if (active) setCatalog(result);
      })
      .catch((e: Error) => {
        if (active) setError(e.message || "Vapi seçenekleri alınamadı.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, demo, user?.openId, revision]);
  return { catalog, loading, error, reload: () => setRevision((v) => v + 1) };
}
export function canUseVapiSelection(
  catalog: VapiOptions | null,
  lineId: string,
  assistantId: string,
) {
  return (
    !!catalog?.lines.some((l) => l.lineId === lineId && l.callable !== false) &&
    !!catalog?.assistants.some((a) => a.id === assistantId)
  );
}
export default function VapiCallFields({
  catalog,
  loading,
  error,
  lineId,
  assistantId,
  onLine,
  onAssistant,
  onReload,
}: {
  catalog: VapiOptions | null;
  loading: boolean;
  error: string;
  lineId: string;
  assistantId: string;
  onLine: (value: string) => void;
  onAssistant: (value: string) => void;
  onReload: () => void;
}) {
  const { demo } = useStore();
  useEffect(() => {
    if (demo) {
      if (!lineId) onLine("ai-1");
      return;
    }
    if (!catalog) return;
    if (!catalog.lines.some((l) => l.lineId === lineId))
      onLine(catalog.lines.find((l) => l.callable !== false)?.lineId || "");
    if (assistantId && !catalog.assistants.some((a) => a.id === assistantId))
      onAssistant("");
    if (
      !assistantId &&
      catalog.defaultAssistantId &&
      catalog.assistants.some((a) => a.id === catalog.defaultAssistantId)
    )
      onAssistant(catalog.defaultAssistantId);
  }, [catalog, demo, lineId, assistantId]);
  return (
    <div className="vapi-selection-fields">
      {loading && (
        <p role="status">Vapi hesabındaki hat ve asistanlar doğrulanıyor…</p>
      )}
      {error && (
        <div role="alert" className="setup-notice">
          <p>{error}</p>
          <button type="button" className="text-button" onClick={onReload}>
            Yeniden kontrol et
          </button>
        </div>
      )}
      <label>
        Aramayı başlatacak hat
        <select
          required
          value={lineId}
          disabled={loading || (!demo && !catalog)}
          onChange={(e) => onLine(e.target.value)}
        >
          <option value="">Vapi hattı seçin</option>
          {demo
            ? lines
                .filter((l) => l.group === "ai")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {formatPhone(l.phone)} · Demo envanter
                  </option>
                ))
            : catalog?.lines.map((l) => (
                <option
                  key={l.lineId}
                  value={l.lineId}
                  disabled={l.callable === false}
                >
                  {formatPhone(l.phone)} ·{" "}
                  {l.name || groupNames[l.group as keyof typeof groupNames]}
                  {l.callable === false ? " · Arama hazır değil" : ""}
                </option>
              ))}
        </select>
      </label>
      <label>
        Vapi asistanı
        <select
          required
          value={assistantId}
          disabled={demo || loading || !catalog}
          onChange={(e) => onAssistant(e.target.value)}
        >
          <option value="">
            {demo
              ? "Demo · Gerçek asistan seçilmez"
              : "Aramayı yapacak asistanı seçin"}
          </option>
          {!demo &&
            catalog?.assistants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
        </select>
      </label>
      {!demo && catalog && (
        <p className="setup-footnote">
          {catalog.lines.length} eşleşmiş hat · {catalog.assistants.length}{" "}
          asistan. Gelen arama asistanı otomatik olarak giden aramaya atanmaz.
          {!catalog.webhookConfigured &&
            " Arama sonuçlarının CRM’ye aktarımı için webhook/n8n köprüsü henüz doğrulanmadı."}
        </p>
      )}
      {!demo && catalog && !catalog.lines.length && (
        <p role="alert">
          Vapi hesabında CRM envanterinizle eşleşen kullanılabilir hat
          bulunamadı.
        </p>
      )}
    </div>
  );
}

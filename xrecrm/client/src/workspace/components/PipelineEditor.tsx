import {
  requiredCrmFields,
  requiredCrmFieldLabels,
  type RequiredCrmField,
} from "../../../../shared/crm-stage-policy";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { useStore } from "../store";
import { Pipeline, baseStages } from "../suite";
import { Modal } from "./ui";
export default function PipelineEditor({
  pipeline,
  onClose,
  onSaved,
}: {
  pipeline?: Pipeline;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { saveRecord } = useStore();
  const stamp = new Date().toISOString();
  const [form, setForm] = useState<Pipeline>(
    pipeline || {
      id: crypto.randomUUID(),
      name: "",
      description: "",
      stages: baseStages.map((s) => ({ ...s })),
      createdAt: stamp,
      updatedAt: stamp,
    },
  );
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveRecord("pipelines", form);
      toast.success("Satış hunisi kaydedildi.");
      onSaved?.(form.id);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={pipeline ? "Satış hunisini düzenle" : "Yeni satış hunisi"}
      subtitle="Her iş kolu için ayrı süreç; aşamalar aynı CRM ve otomasyon altyapısını kullanır."
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="modal-content form-grid">
          <label className="full">
            Huni adı
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Örn. Konut Satış / Kiralama"
            />
          </label>
          <label className="full">
            Açıklama
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <div className="full pipeline-editor-stages">
            <h4>Aşamalar</h4>
            <p>
              Kararlı statü kimlikleri korunur. Başlık ve renkleri iş sürecinize
              uyarlayın.
            </p>
            {form.stages.map((s, i) => (
              <div key={s.id}>
                <input
                  type="color"
                  aria-label={`${s.label} rengi`}
                  value={s.color}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      stages: form.stages.map((x, j) =>
                        j === i ? { ...x, color: e.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  required
                  aria-label={`${s.id} aşama adı`}
                  value={s.label}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      stages: form.stages.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <span>{s.id}</span>
              </div>
            ))}
          </div>
          <section className="full stage-required-editor">
            <h4>Aşamaya göre zorunlu alanlar</h4>
            <p>
              İşaretlediğiniz alanlar doldurulmadan müşteri bu aşamaya
              taşınamaz. Randevu tarih-saat zorunluluğu ayrıca korunur. Mevcut
              kayıtlar topluca değiştirilmez.
            </p>
            {form.stages.map((stage) => (
              <details key={stage.id}>
                <summary>
                  {stage.label}
                  <span>
                    {(form.requiredFieldsByStage?.[stage.id] || []).length}{" "}
                    zorunlu alan
                  </span>
                </summary>
                <div>
                  {requiredCrmFields.map((field) => (
                    <label key={field}>
                      <input
                        type="checkbox"
                        checked={(
                          form.requiredFieldsByStage?.[stage.id] || []
                        ).includes(field)}
                        aria-label={`${stage.label} için ${requiredCrmFieldLabels[field]} zorunlu`}
                        onChange={(e) =>
                          setForm((previous) => {
                            const old =
                              previous.requiredFieldsByStage?.[stage.id] || [];
                            const chosen: RequiredCrmField[] = e.target.checked
                              ? [...old, field]
                              : old.filter((x) => x !== field);
                            return {
                              ...previous,
                              requiredFieldsByStage: {
                                ...previous.requiredFieldsByStage,
                                [stage.id]: chosen,
                              },
                            };
                          })
                        }
                      />
                      {requiredCrmFieldLabels[field]}
                    </label>
                  ))}
                </div>
              </details>
            ))}
          </section>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn primary" disabled={busy}>
            <Save size={15} />
            {busy ? "Kaydediliyor…" : "Huniyi kaydet"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

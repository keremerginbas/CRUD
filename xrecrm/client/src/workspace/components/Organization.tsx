import { useState } from "react";
import { Building2, Plus, Edit3, Users, Check } from "lucide-react";
import { toast } from "sonner";
import { Modal, Avatar, Badge } from "./ui";
import { AccessDepartment, AccessEmployee } from "../../../../shared/access";
export default function Organization({
  departments,
  employees,
  editable,
  onSave,
}: {
  departments: AccessDepartment[];
  employees: AccessEmployee[];
  editable: boolean;
  onSave: (d: AccessDepartment) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(
    departments[0]?.id || null,
  );
  const [draft, setDraft] = useState<AccessDepartment | null>(null);
  const [busy, setBusy] = useState(false);
  const current = departments.find((d) => d.id === selected);
  const people = employees.filter((e) => e.departmentId === selected);
  const draw = (parent: string | undefined, seen = new Set<string>()): any =>
    departments
      .filter((d) => (d.parentId || "") === (parent || "") && !seen.has(d.id))
      .map((d) => {
        const next = new Set(seen);
        next.add(d.id);
        return (
          <div className="cx-org-branch" key={d.id}>
            <button
              className={`cx-org-node ${selected === d.id ? "selected" : ""}`}
              onClick={() => setSelected(d.id)}
            >
              <Building2 size={18} />
              <strong>{d.name}</strong>
              <small>
                {employees.filter((e) => e.departmentId === d.id).length}{" "}
                çalışan
              </small>
              <span>Departman</span>
            </button>
            <div className="cx-org-children">{draw(d.id, next)}</div>
          </div>
        );
      });
  return (
    <>
      <div className="cx-org-heading">
        <span>
          <Building2 size={18} />
          Şirket yapısı
        </span>
        {editable && (
          <button
            className="btn primary"
            onClick={() =>
              setDraft({
                id: crypto.randomUUID(),
                name: "",
                parentId: selected || undefined,
                active: true,
              })
            }
          >
            <Plus size={14} />
            Departman ekle
          </button>
        )}
      </div>
      <div className="cx-org-layout">
        <div className="cx-org-canvas">
          <div className="cx-org-roots">{draw(undefined)}</div>
          {!departments.length && (
            <div className="cx-no-todos">
              İlk departmanınızı ekleyerek şirket yapısını oluşturun.
            </div>
          )}
        </div>
        <aside className="cx-org-detail">
          <header>
            <h3>{current?.name || "Departman seçin"}</h3>
            {current && editable && (
              <button
                aria-label="Departmanı düzenle"
                onClick={() => setDraft({ ...current })}
              >
                <Edit3 size={14} />
              </button>
            )}
          </header>
          <Badge>{people.length} çalışan</Badge>
          <h4>Departman çalışanları</h4>
          {people.map((e) => (
            <div key={e.id}>
              <Avatar name={e.name} size={36} />
              <span>
                <strong>{e.name}</strong>
                <small>{e.title || "Pozisyon belirtilmedi"}</small>
              </span>
              <Badge tone={e.active ? "green" : "gray"}>
                {e.active ? "Etkin" : "Pasif"}
              </Badge>
            </div>
          ))}
          {!people.length && (
            <p>Çalışan listesindeki departman seçicisiyle kişi atayın.</p>
          )}
        </aside>
      </div>
      {draft && (
        <Modal
          title={
            departments.some((d) => d.id === draft.id)
              ? "Departmanı düzenle"
              : "Departman ekle"
          }
          onClose={() => setDraft(null)}
        >
          <form
            className="cx-department-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.name.trim()) return;
              setBusy(true);
              try {
                await onSave({ ...draft, name: draft.name.trim() });
                setSelected(draft.id);
                setDraft(null);
                toast.success("Şirket yapısı güncellendi.");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Departman adı
              <input
                autoFocus
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Üst departman
              <select
                value={draft.parentId || ""}
                onChange={(e) =>
                  setDraft({ ...draft, parentId: e.target.value || undefined })
                }
              >
                <option value="">Üst departman yok</option>
                {departments
                  .filter((d) => d.id !== draft.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Departman ataması tek başına erişim vermez; çalışanın rol izinleri
              geçerlidir.
            </p>
            <button className="btn primary" disabled={busy}>
              <Check size={14} />
              Kaydet
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

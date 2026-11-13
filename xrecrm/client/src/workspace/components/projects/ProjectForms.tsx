// Proje ve daire oluşturma/düzenleme pencereleri ile daire ayrıntı penceresi.
import { useRef, useState } from "react";
import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  PROJECT_IMAGE_KINDS,
  PROJECT_STATUSES,
  UNIT_CURRENCIES,
  UNIT_STATUSES,
  formatFloor,
  formatM2,
  formatPrice,
  pricePerM2,
  type Project,
  type ProjectImage,
  type ProjectImageKind,
  type ProjectStatus,
  type Unit,
  type UnitCurrency,
  type UnitStatus,
} from "../../../../../shared/real-estate";
import { parseTrNumber } from "../../../../../shared/unit-import";
import { Modal } from "../ui";
import { newId, type InventoryStore } from "../../projects";
import { NumberField, statusLabel, statusTone } from "./UnitExplorer";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const projectStatusLabel: Record<ProjectStatus, string> = { satışta: "Satışta", yakında: "Yakında", tamamlandı: "Tamamlandı" };
export const imageKindLabel: Record<ProjectImageKind, string> = { render: "Render", gerçek: "Gerçek" };
const splitTags = (value: string) =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 60);

export function blankProject(): Project {
  const stamp = new Date().toISOString();
  return {
    id: newId("project"), name: "", city: "", district: "", address: "", description: "", status: "satışta", deliveryDate: "",
    developer: "", amenities: [], images: [], archived: false, createdAt: stamp, updatedAt: stamp,
  };
}
export function blankUnit(projectId: string): Unit {
  const stamp = new Date().toISOString();
  return {
    id: newId("unit"), projectId, block: "", floor: 1, unitNo: "", type: "", grossM2: 0, netM2: 0, facade: "", view: "", listPrice: 0,
    currency: "TRY", status: "müsait", features: [], notes: "", floorPlanImageUrl: "", archived: false, createdAt: stamp, updatedAt: stamp,
  };
}

function DemoImageNote({ demo }: { demo: boolean }) {
  return demo ? <p className="pj-note">Demo modunda görseller sunucuya yüklenmez; yalnız bu oturumda (sayfa yenilenene kadar) görünür.</p> : null;
}

export function ProjectEditor({ project, isNew, store, onClose }: { project: Project; isNew: boolean; store: InventoryStore; onClose: () => void }) {
  const [draft, setDraft] = useState<Project>(project);
  const [amenities, setAmenities] = useState(project.amenities.join(", "));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<ProjectImageKind>("render");
  const fileInput = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Project>) => setDraft((current) => ({ ...current, ...patch }));
  const updateImage = (id: string, patch: Partial<ProjectImage>) => update({ images: draft.images.map((image) => (image.id === id ? { ...image, ...patch } : image)) });

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const added: ProjectImage[] = [];
    for (const file of Array.from(files).slice(0, 20)) {
      try {
        added.push({ id: newId("img"), url: await store.uploadImage(file), kind, caption: "" });
      } catch (error) {
        toast.error(`${file.name}: ${(error as Error).message}`);
      }
    }
    setDraft((current) => ({ ...current, images: [...current.images, ...added].slice(0, 60) }));
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return void toast.error("Proje adı gerekli.");
    setSaving(true);
    try {
      await store.saveProject({ ...draft, name: draft.name.trim(), amenities: splitTags(amenities) });
      toast.success(isNew ? "Proje oluşturuldu." : "Proje güncellendi.");
      onClose();
    } catch (error) {
      toast.error((error as Error).message || "Proje kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal wide title={isNew ? "Yeni proje" : "Projeyi düzenle"} subtitle="Proje bilgileri, olanaklar ve görseller." onClose={onClose}>
      <form className="sx-modal-form pj-form" onSubmit={submit}>
        <div className="sx-form-grid">
          <label className="sx-field sx-span-2">
            Proje adı
            <input autoFocus value={draft.name} maxLength={200} onChange={(e) => update({ name: e.target.value })} placeholder="Örn. Vadi Konutları" />
          </label>
          <label className="sx-field">
            İl
            <input value={draft.city} maxLength={80} onChange={(e) => update({ city: e.target.value })} placeholder="İstanbul" />
          </label>
          <label className="sx-field">
            İlçe
            <input value={draft.district} maxLength={80} onChange={(e) => update({ district: e.target.value })} placeholder="Kartal" />
          </label>
          <label className="sx-field sx-span-2">
            Adres
            <input value={draft.address} maxLength={500} onChange={(e) => update({ address: e.target.value })} />
          </label>
          <label className="sx-field">
            Durum
            <select value={draft.status} onChange={(e) => update({ status: e.target.value as ProjectStatus })}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{projectStatusLabel[s]}</option>
              ))}
            </select>
          </label>
          <label className="sx-field">
            Teslim tarihi
            <input type="date" value={draft.deliveryDate} onChange={(e) => update({ deliveryDate: e.target.value })} />
          </label>
          <label className="sx-field sx-span-2">
            Geliştirici / mal sahibi firma
            <input value={draft.developer} maxLength={200} onChange={(e) => update({ developer: e.target.value })} />
          </label>
          <label className="sx-field sx-span-2">
            Açıklama
            <textarea rows={4} value={draft.description} maxLength={10000} onChange={(e) => update({ description: e.target.value })} />
          </label>
          <label className="sx-field sx-span-2">
            Olanaklar (virgülle ayırın)
            <input value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="Kapalı otopark, Havuz, Güvenlik" />
          </label>
          <div className="sx-field sx-span-2">
            Görseller
            <div className="pj-upload-row">
              <select className="pj-input" aria-label="Yüklenecek görsel türü" value={kind} onChange={(e) => setKind(e.target.value as ProjectImageKind)}>
                {PROJECT_IMAGE_KINDS.map((k) => (
                  <option key={k} value={k}>{imageKindLabel[k]}</option>
                ))}
              </select>
              <input ref={fileInput} type="file" hidden multiple accept={IMAGE_ACCEPT} onChange={(e) => void addFiles(e.target.files)} />
              <button type="button" className="btn secondary pj-touch" disabled={uploading} onClick={() => fileInput.current?.click()}>
                <ImagePlus size={16} /> {uploading ? "Yükleniyor…" : "Görsel ekle"}
              </button>
              <span className="pj-muted">JPEG, PNG veya WebP · en çok 8 MB</span>
            </div>
            <DemoImageNote demo={store.demo} />
            {draft.images.length > 0 && (
              <ul className="pj-image-list">
                {draft.images.map((image) => (
                  <li key={image.id}>
                    <img src={image.url} alt="" loading="lazy" />
                    <select className="pj-input" aria-label="Görsel türü" value={image.kind} onChange={(e) => updateImage(image.id, { kind: e.target.value as ProjectImageKind })}>
                      {PROJECT_IMAGE_KINDS.map((k) => (
                        <option key={k} value={k}>{imageKindLabel[k]}</option>
                      ))}
                    </select>
                    <input className="pj-input" aria-label="Görsel açıklaması" placeholder="Açıklama" maxLength={200} value={image.caption} onChange={(e) => updateImage(image.id, { caption: e.target.value })} />
                    <button type="button" className="icon-button pj-touch" aria-label="Görseli kaldır" onClick={() => update({ images: draft.images.filter((i) => i.id !== image.id) })}>
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="sx-modal-footer">
          <span className="sx-muted">İlk görsel kapak olarak kullanılır.</span>
          <div className="sx-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Vazgeç</button>
            <button type="submit" className="btn primary" disabled={saving || uploading}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function UnitEditor({ unit, isNew, projects, store, onClose }: { unit: Unit; isNew: boolean; projects: Project[]; store: InventoryStore; onClose: () => void }) {
  const [draft, setDraft] = useState<Unit>(unit);
  const [features, setFeatures] = useState(unit.features.join(", "));
  const [floor, setFloor] = useState(String(unit.floor));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Unit>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const floorNumber = parseTrNumber(floor);
    if (!draft.projectId) return void toast.error("Proje seçin.");
    if (!draft.unitNo.trim()) return void toast.error("Daire no gerekli.");
    if (floorNumber == null || !Number.isInteger(floorNumber) || floorNumber < -20 || floorNumber > 300) return void toast.error("Kat tam sayı olmalı (bodrum için eksi değer).");
    setSaving(true);
    try {
      await store.saveUnit({ ...draft, unitNo: draft.unitNo.trim(), block: draft.block.trim(), floor: floorNumber, features: splitTags(features) });
      toast.success(isNew ? "Daire eklendi." : "Daire güncellendi.");
      onClose();
    } catch (error) {
      toast.error((error as Error).message || "Daire kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };
  const addPlan = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      update({ floorPlanImageUrl: await store.uploadImage(file) });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <Modal wide title={isNew ? "Yeni daire" : "Daireyi düzenle"} subtitle="Bağımsız bölüm bilgileri. Blok + daire no proje içinde tekil olmalı." onClose={onClose}>
      <form className="sx-modal-form pj-form" onSubmit={submit}>
        <div className="sx-form-grid">
          <label className="sx-field sx-span-2">
            Proje
            <select value={draft.projectId} onChange={(e) => update({ projectId: e.target.value })}>
              <option value="">Proje seçin</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="sx-field">
            Blok
            <input value={draft.block} maxLength={40} onChange={(e) => update({ block: e.target.value })} placeholder="A" />
          </label>
          <label className="sx-field">
            Daire no
            <input autoFocus={isNew} value={draft.unitNo} maxLength={40} onChange={(e) => update({ unitNo: e.target.value })} placeholder="12" />
          </label>
          <label className="sx-field">
            Kat
            <input inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="3" />
          </label>
          <label className="sx-field">
            Tip
            <input value={draft.type} maxLength={40} onChange={(e) => update({ type: e.target.value })} placeholder="2+1" />
          </label>
          <div className="sx-field">
            Brüt m²
            <NumberField label="Brüt m²" value={draft.grossM2 || null} onChange={(v) => update({ grossM2: Math.max(0, v ?? 0) })} />
          </div>
          <div className="sx-field">
            Net m²
            <NumberField label="Net m²" value={draft.netM2 || null} onChange={(v) => update({ netM2: Math.max(0, v ?? 0) })} />
          </div>
          <label className="sx-field">
            Cephe / yön
            <input value={draft.facade} maxLength={80} onChange={(e) => update({ facade: e.target.value })} placeholder="Güneybatı" />
          </label>
          <label className="sx-field">
            Manzara
            <input value={draft.view} maxLength={120} onChange={(e) => update({ view: e.target.value })} placeholder="Deniz" />
          </label>
          <div className="sx-field">
            Liste fiyatı
            <NumberField label="Liste fiyatı" price value={draft.listPrice || null} onChange={(v) => update({ listPrice: Math.max(0, v ?? 0) })} placeholder="4.250.000" />
          </div>
          <label className="sx-field">
            Para birimi
            <select value={draft.currency} onChange={(e) => update({ currency: e.target.value as UnitCurrency })}>
              {UNIT_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="sx-field sx-span-2">
            Durum
            <select value={draft.status} onChange={(e) => update({ status: e.target.value as UnitStatus })}>
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel[s]}</option>
              ))}
            </select>
          </label>
          <label className="sx-field sx-span-2">
            Özellikler (virgülle ayırın)
            <input value={features} onChange={(e) => setFeatures(e.target.value)} placeholder="Balkon, Ebeveyn banyosu" />
          </label>
          <label className="sx-field sx-span-2">
            Notlar
            <textarea rows={3} value={draft.notes} maxLength={10000} onChange={(e) => update({ notes: e.target.value })} />
          </label>
          <div className="sx-field sx-span-2">
            Kat planı görseli
            <div className="pj-upload-row">
              <input ref={fileInput} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => void addPlan(e.target.files)} />
              <button type="button" className="btn secondary pj-touch" disabled={uploading} onClick={() => fileInput.current?.click()}>
                <ImagePlus size={16} /> {uploading ? "Yükleniyor…" : draft.floorPlanImageUrl ? "Değiştir" : "Kat planı ekle"}
              </button>
              {draft.floorPlanImageUrl && (
                <button type="button" className="btn secondary pj-touch" onClick={() => update({ floorPlanImageUrl: "" })}>
                  <Trash2 size={16} /> Kaldır
                </button>
              )}
            </div>
            <DemoImageNote demo={store.demo} />
            {draft.floorPlanImageUrl && <img className="pj-plan-preview" src={draft.floorPlanImageUrl} alt="Kat planı önizlemesi" />}
          </div>
        </div>
        <div className="sx-modal-footer">
          <span className="sx-muted">Fiyat boş bırakılırsa daire bütçe aramalarında görünmez.</span>
          <div className="sx-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Vazgeç</button>
            <button type="submit" className="btn primary" disabled={saving || uploading}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function UnitDetail({
  unit, project, canWrite, onClose, onEdit, onArchive,
}: {
  unit: Unit;
  project?: Project;
  canWrite: boolean;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const perM2 = pricePerM2(unit);
  const facts: [string, string][] = [
    ["Proje", project?.name || "—"],
    ["Blok", unit.block || "—"],
    ["Kat", formatFloor(unit.floor)],
    ["Tip", unit.type || "—"],
    ["Brüt", formatM2(unit.grossM2)],
    ["Net", formatM2(unit.netM2)],
    ["Cephe", unit.facade || "—"],
    ["Manzara", unit.view || "—"],
    ["m² fiyatı (brüt)", perM2 == null ? "—" : formatPrice(perM2, unit.currency)],
  ];
  return (
    <Modal wide title={`${unit.block ? `${unit.block} Blok · ` : ""}No ${unit.unitNo}`} subtitle={[project?.name, project?.district, project?.city].filter(Boolean).join(" · ")} onClose={onClose}>
      <div className="pj-detail-body">
        <div className="pj-detail-price">
          <strong>{formatPrice(unit.listPrice, unit.currency)}</strong>
          <span className={`pj-status pj-tone-${statusTone[unit.status]}`}>{statusLabel[unit.status]}</span>
        </div>
        <dl className="pj-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {unit.features.length > 0 && (
          <div className="pj-tags">
            {unit.features.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        )}
        {unit.notes && <p className="pj-text">{unit.notes}</p>}
        {unit.floorPlanImageUrl && <img className="pj-plan-preview" src={unit.floorPlanImageUrl} alt="Kat planı" />}
      </div>
      {canWrite && (
        <div className="sx-modal-footer pj-detail-foot">
          <button type="button" className="btn secondary pj-touch" onClick={onArchive}>Arşivle</button>
          <div className="sx-actions">
            <button type="button" className="btn primary pj-touch" onClick={onEdit}>
              <Pencil size={15} /> Düzenle
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

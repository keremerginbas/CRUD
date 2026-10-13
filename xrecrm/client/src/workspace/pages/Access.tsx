import { accessDemoFixture } from "../access-demo";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import {
  LockKeyhole,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { PageTitle } from "../components/ui";
import { useStore } from "../store";
import {
  ACCESS_MODULES,
  ACCESS_MODULE_LABELS,
  DEFAULT_ROLES,
  clonePermissionMap,
  type AccessRole,
  type AccessModule,
  type PermissionMap,
} from "../../../../shared/access";
import "../access.css";

type AccessPayload = {
  roles: AccessRole[];
  employees: any[];
  departments: any[];
};
const fixtureKey = "xre-access-demo-v1";

function fixture(): AccessPayload {
  try {
    const value = JSON.parse(localStorage.getItem(fixtureKey) || "null");
    if (value?.roles) return value;
  } catch {
    /* use defaults */
  }
  return accessDemoFixture();
}

export default function Access() {
  const { demo, request, user } = useStore();
  const [payload, setPayload] = useState<AccessPayload>(() => fixture());
  const [selected, setSelected] = useState("manager");
  const [draft, setDraft] = useState<AccessRole | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedRole = useMemo(
    () =>
      payload.roles.find((role) => role.id === selected) || payload.roles[0],
    [payload.roles, selected],
  );

  useEffect(() => {
    if (demo) {
      const value = fixture();
      setPayload(value);
      setSelected((current) =>
        value.roles.some((role) => role.id === current)
          ? current
          : value.roles[0]?.id || "manager",
      );
      return;
    }
    request("/api/access")
      .then((value) => setPayload(value))
      .catch(() => undefined);
  }, [demo, request]);
  useEffect(() => {
    setDraft(
      selectedRole
        ? { ...selectedRole, grants: clonePermissionMap(selectedRole.grants) }
        : null,
    );
  }, [selectedRole]);

  const isOwner = demo || Boolean(user?.isOwner);
  const updateGrant = (
    module: AccessModule,
    patch: Partial<PermissionMap[AccessModule]>,
  ) => {
    if (!draft || draft.locked) return;
    setDraft({
      ...draft,
      grants: {
        ...draft.grants,
        [module]: { ...draft.grants[module], ...patch },
      },
    });
  };
  const save = async () => {
    if (!draft || draft.locked || !isOwner) return;
    const changes = ACCESS_MODULES.filter(
      (m) =>
        JSON.stringify(draft.grants[m]) !==
        JSON.stringify(selectedRole.grants[m]),
    );
    if (!demo && changes.length) {
      const effects = changes
        .map(
          (m) =>
            `${ACCESS_MODULE_LABELS[m]}: ${draft.grants[m].read ? "okuma açık" : "okuma kapalı"}, ${draft.grants[m].write ? "yazma açık" : "yazma kapalı"}, ${draft.grants[m].scope === "all" ? "tüm kayıtlar" : "kendi kayıtları"}`,
        )
        .join("\n");
      const people =
        payload.employees
          .filter((e) => e.roleId === draft.id && e.active)
          .map((e) => e.name)
          .join(", ") || "Bu role atanmış etkin çalışan yok";
      if (
        !window.confirm(
          `${draft.name} rolü değiştirilecek:\n\n${effects}\n\nEtkilenen çalışanlar: ${people}\nDeğişiklik yeni isteklere hemen uygulanır. Onaylıyor musunuz?`,
        )
      )
        return;
    }
    setSaving(true);
    try {
      if (demo) {
        const next = {
          ...payload,
          roles: payload.roles.map((role) =>
            role.id === draft.id ? draft : role,
          ),
        };
        setPayload(next);
        localStorage.setItem(fixtureKey, JSON.stringify(next));
      } else {
        await request(`/api/access/roles/${draft.id}`, draft, "PUT");
        setPayload((current) => ({
          ...current,
          roles: current.roles.map((role) =>
            role.id === draft.id ? draft : role,
          ),
        }));
      }
      toast.success(
        demo
          ? "Örnek rol güncellendi; gerçek erişim değişmedi."
          : "Rol izinleri güncellendi.",
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="access-page">
      <PageTitle
        eyebrow="ÇALIŞMA ALANI / ERİŞİM"
        title="Erişim ve roller"
        description="Her modül için okuma, yazma ve kayıt kapsamını açıkça tanımlayın."
        actions={
          <span className="access-security">
            <ShieldCheck size={16} /> Manus kimliğiyle korunuyor
          </span>
        }
      />
      {demo && (
        <div className="access-notice">
          <ShieldCheck size={17} />
          <span>
            Demo roller ve çalışanlar · Değişiklikler yalnız bu tarayıcıda
            saklanır; gerçek erişim verilmez.
          </span>
        </div>
      )}
      {!isOwner && (
        <div className="access-notice">
          <LockKeyhole size={17} />
          <span>
            Roller salt okunur. Rol veya yetki değişiklikleri yalnızca çalışma
            alanı sahibine açıktır.
          </span>
        </div>
      )}
      <div className="access-layout">
        <aside className="access-role-list panel">
          <div className="access-panel-heading">
            <div>
              <span className="eyebrow">ROLLER</span>
              <h3>Yetki profilleri</h3>
            </div>
            <SlidersHorizontal size={17} />
          </div>
          {payload.roles.map((role) => (
            <button
              key={role.id}
              className={`access-role-item ${role.id === selected ? "active" : ""}`}
              onClick={() => setSelected(role.id)}
            >
              <span className="access-role-icon">
                {role.id === "owner" ? (
                  <LockKeyhole size={15} />
                ) : (
                  <ShieldCheck size={15} />
                )}
              </span>
              <span>
                <strong>{role.name}</strong>
                <small>{role.description}</small>
              </span>
              {role.locked && <LockKeyhole size={13} />}
            </button>
          ))}
          <p className="access-footnote">
            Sahip rolü kilitlidir. Yönetici, Satış ve Gözlemci varsayılan
            profilleri özelleştirilebilir.
          </p>
        </aside>
        <section className="access-grant-card panel">
          {draft && (
            <>
              <div className="access-panel-heading access-grant-heading">
                <div>
                  <span className="eyebrow">MODÜL MATRİSİ</span>
                  <h2>{draft.name}</h2>
                  <p>{draft.description}</p>
                </div>
                <button
                  className="btn primary"
                  disabled={draft.locked || !isOwner || saving}
                  onClick={() => void save()}
                >
                  <Save size={15} />
                  {saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
                </button>
              </div>
              <div className="grant-grid grant-grid-head">
                <span>Modül</span>
                <span>Oku</span>
                <span>Yaz</span>
                <span>Kapsam</span>
              </div>
              <div className="grant-grid grant-grid-body">
                {ACCESS_MODULES.map((module) => {
                  const grant = draft.grants[module];
                  return (
                    <div className="grant-row" key={module}>
                      <div>
                        <strong>{ACCESS_MODULE_LABELS[module]}</strong>
                        <small>{module}</small>
                      </div>
                      <label className="access-check">
                        <input
                          type="checkbox"
                          checked={grant.read}
                          disabled={draft.locked || !isOwner}
                          onChange={(event) =>
                            updateGrant(module, { read: event.target.checked })
                          }
                        />
                        <span>Okuma</span>
                      </label>
                      <label className="access-check">
                        <input
                          type="checkbox"
                          checked={grant.write}
                          disabled={draft.locked || !isOwner}
                          onChange={(event) =>
                            updateGrant(module, { write: event.target.checked })
                          }
                        />
                        <span>Yazma</span>
                      </label>
                      <select
                        disabled={draft.locked || !isOwner}
                        value={grant.scope}
                        onChange={(event) =>
                          updateGrant(module, {
                            scope: event.target.value as "all" | "own",
                          })
                        }
                      >
                        <option value="own">Yalnızca kendi kayıtları</option>
                        <option value="all">Tüm ekip kayıtları</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              <div className="access-grant-note">
                <span className="green-dot" />
                <span>
                  İzin değişiklikleri yeni isteklerde uygulanır; mevcut
                  oturumlar yeniden doğrulanır.
                </span>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

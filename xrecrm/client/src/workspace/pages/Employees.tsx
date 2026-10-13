import Organization from "../components/Organization";
import { accessDemoFixture } from "../access-demo";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  KeyRound,
  LockKeyhole,
  Plus,
  UserRound,
  UserRoundX,
} from "lucide-react";
import { PageTitle } from "../components/ui";
import LoginAccounts from "../components/LoginAccounts";
import { useStore } from "../store";
import {
  DEFAULT_ROLES,
  type AccessDepartment,
  type AccessEmployee,
  type AccessRole,
} from "../../../../shared/access";
import "../access.css";

type AccessPayload = {
  roles: AccessRole[];
  employees: AccessEmployee[];
  departments: AccessDepartment[];
};
const fixtureKey = "xre-access-demo-v1";
const emptyForm = {
  name: "",
  email: "",
  openId: "",
  departmentId: "",
  roleId: "observer",
  title: "",
  phone: "",
};

function readFixture(): AccessPayload {
  try {
    const value = JSON.parse(localStorage.getItem(fixtureKey) || "null");
    if (value?.roles) return value;
  } catch {
    /* defaults */
  }
  return accessDemoFixture();
}

export default function Employees({
  structure = false,
}: { structure?: boolean } = {}) {
  const { demo, request, user } = useStore();
  const [payload, setPayload] = useState<AccessPayload>(() => readFixture());
  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const isOwner = demo || Boolean(user?.isOwner);
  const load = () =>
    demo
      ? Promise.resolve(setPayload(readFixture()))
      : request("/api/access")
          .then(setPayload)
          .catch(() => undefined);
  useEffect(() => {
    void load();
  }, [demo]);
  const roles = useMemo(
    () => new Map(payload.roles.map((role) => [role.id, role])),
    [payload.roles],
  );
  const departments = useMemo(
    () =>
      new Map(
        payload.departments.map((department) => [department.id, department]),
      ),
    [payload.departments],
  );
  const employees = payload.employees.filter((employee) =>
    `${employee.name} ${employee.email} ${employee.openId} ${employee.title}`
      .toLocaleLowerCase("tr")
      .includes(query.toLocaleLowerCase("tr")),
  );
  const saveDemo = (next: AccessPayload) => {
    setPayload(next);
    localStorage.setItem(fixtureKey, JSON.stringify(next));
  };
  const addEmployee = async (event: FormEvent) => {
    event.preventDefault();
    if (!isOwner || !form.openId.trim()) return;
    if (
      !window.confirm(
        `Çalışan eşlemesi oluşturulsun mu?\n\nManus openId: ${form.openId}\nRol: ${roles.get(form.roleId)?.name || form.roleId}\n\nDavet e-postası veya parola oluşturulmaz. Çalışan varsayılan olarak pasif kalır.`,
      )
    )
      return;
    setBusy("new");
    try {
      const created: AccessEmployee = {
        ...form,
        id: `employee_${Date.now()}`,
        openId: form.openId.trim(),
        active: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (demo)
        saveDemo({ ...payload, employees: [created, ...payload.employees] });
      else await request("/api/access/employees", created, "POST");
      setAdding(false);
      setForm(emptyForm);
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const changeEmployee = async (
    employee: AccessEmployee,
    patch: Partial<AccessEmployee>,
  ) => {
    if (!isOwner || employee.openId === user?.openId) return;
    const next = { ...employee, ...patch };
    const assignmentChanged =
      patch.roleId !== undefined || patch.departmentId !== undefined;
    const roleText = roles.get(next.roleId)?.name || next.roleId;
    const deptText = departments.get(next.departmentId)?.name || "Departmansız";
    const prompt = assignmentChanged
      ? `${employee.name} için yeni atama:\n\nRol: ${roleText}\nDepartman: ${deptText}\nKapsam ve izinler bu role göre uygulanır.\n\nDevam edilsin mi?`
      : `${employee.name} hesabı ${next.active ? "etkinleştirilsin" : "pasifleştirilsin"} mi?\n\nManus openId: ${employee.openId}\nBu işlem davet veya kullanıcı silme işlemi değildir.`;
    if (!window.confirm(prompt)) return;
    setBusy(employee.id);
    try {
      if (demo)
        saveDemo({
          ...payload,
          employees: payload.employees.map((item) =>
            item.id === employee.id ? next : item,
          ),
        });
      else await request(`/api/access/employees/${employee.id}`, next, "PATCH");
      await load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="access-page">
      <PageTitle
        eyebrow="ÇALIŞMA ALANI / EKİP"
        title={structure ? "Ekip yapısı" : "Çalışanlar"}
        description="Çalışanlara giriş hesabı açın; yetkiler seçtiğiniz rolden gelir."
        actions={
          isOwner && (
            <button className="btn primary" onClick={() => setAdding(true)}>
              <Plus size={16} /> Çalışan ekle
            </button>
          )
        }
      />
      {!structure && <LoginAccounts />}
      {demo && (
        <div className="access-notice">
          Örnek ekip yapısı · gerçek çalışan hesabı veya erişim oluşturulmaz.
        </div>
      )}
      <div className="access-notice">
        <KeyRound size={17} />
        <span>
          Giriş yapabilen çalışanları yukarıdaki <strong>Giriş hesapları</strong>{" "}
          bölümünden açın. Bu listeden eklenen kayıtlar yalnız Manus kimliğiyle
          eşleşir ve <strong>pasif</strong> başlar.
        </span>
      </div>
      {structure && (
        <Organization
          departments={payload.departments}
          employees={payload.employees}
          editable={isOwner}
          onSave={async (department) => {
            if (demo) {
              const next = {
                ...payload,
                departments: [
                  ...payload.departments.filter((d) => d.id !== department.id),
                  department,
                ],
              };
              const seen = new Set<string>();
              let id = department.parentId;
              while (id) {
                if (id === department.id || seen.has(id))
                  throw new Error("Departman yapısında döngü oluşturulamaz.");
                seen.add(id);
                id = next.departments.find((d) => d.id === id)?.parentId;
              }
              saveDemo(next);
            } else {
              await request(
                `/api/access/departments${payload.departments.some((d) => d.id === department.id) ? `/${department.id}` : ""}`,
                department,
                payload.departments.some((d) => d.id === department.id)
                  ? "PATCH"
                  : "POST",
              );
              await load();
            }
          }}
        />
      )}
      <section className="panel employee-panel">
        <div className="employee-toolbar">
          <label className="access-search">
            <UserRound size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="İsim, openId veya rol ara…"
            />
          </label>
          <span className="access-count">{employees.length} çalışan</span>
        </div>
        <div className="employee-table">
          <div className="employee-head">
            <span>Çalışan</span>
            <span>Manus kimliği</span>
            <span>Departman</span>
            <span>Rol</span>
            <span>Durum</span>
            <span />
          </div>
          {employees.length === 0 && (
            <div className="access-empty">
              <UserRoundX size={24} />
              <strong>Henüz çalışan yok</strong>
              <span>
                Yalnızca gerçek Manus kimliği eşleştirilmiş çalışanlar burada
                görünür.
              </span>
            </div>
          )}
          {employees.map((employee) => {
            const owner =
              employee.openId === user?.openId ||
              roles.get(employee.roleId)?.id === "owner";
            const role = roles.get(employee.roleId);
            return (
              <div className="employee-row" key={employee.id}>
                <div className="employee-person">
                  <span className="employee-avatar">
                    {employee.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{employee.name}</strong>
                    <small>
                      {employee.title || "Pozisyon belirtilmedi"} ·{" "}
                      {employee.email || "E-posta paylaşılmadı"}
                    </small>
                  </span>
                </div>
                <code>{employee.openId}</code>
                <select
                  aria-label={`${employee.name} departmanı`}
                  value={employee.departmentId}
                  disabled={!isOwner || owner || busy === employee.id}
                  onChange={(event) =>
                    void changeEmployee(employee, {
                      departmentId: event.target.value,
                    })
                  }
                >
                  <option value="">Departmansız</option>
                  {payload.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={employee.roleId}
                  disabled={!isOwner || owner || busy === employee.id}
                  onChange={(event) =>
                    void changeEmployee(employee, {
                      roleId: event.target.value,
                    })
                  }
                >
                  {payload.roles
                    .filter((item) => item.id !== "owner")
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
                <button
                  className={`status-button ${employee.active ? "active" : ""}`}
                  disabled={!isOwner || owner || busy === employee.id}
                  onClick={() =>
                    void changeEmployee(employee, { active: !employee.active })
                  }
                >
                  {employee.active ? (
                    <>
                      <Check size={14} /> Etkin
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={14} /> Pasif
                    </>
                  )}
                </button>
                <span className="employee-protected">
                  {owner ? (
                    <LockKeyhole size={15} aria-label="Korunan owner" />
                  ) : (
                    ""
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      {adding && (
        <div className="access-dialog-backdrop">
          <form
            className="panel access-dialog"
            onSubmit={(event) => void addEmployee(event)}
          >
            <div className="access-dialog-head">
              <div>
                <span className="eyebrow">YENİ EŞLEŞME</span>
                <h2>Çalışan ekle</h2>
                <p>
                  Bu yalnızca mevcut Manus kimliğini CRM çalışan kaydına bağlar.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setAdding(false)}
              >
                ×
              </button>
            </div>
            <div className="access-form-grid">
              <label>
                Ad soyad
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label>
                E-posta{" "}
                <span className="field-hint">erişim anahtarı değildir</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </label>
              <label className="full">
                Manus openId{" "}
                <input
                  required
                  value={form.openId}
                  onChange={(event) =>
                    setForm({ ...form, openId: event.target.value })
                  }
                  placeholder="Profilde görünen gerçek openId"
                />
              </label>
              <label>
                Rol
                <select
                  value={form.roleId}
                  onChange={(event) =>
                    setForm({ ...form, roleId: event.target.value })
                  }
                >
                  {payload.roles
                    .filter((role) => role.id !== "owner")
                    .map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Departman
                <select
                  value={form.departmentId}
                  onChange={(event) =>
                    setForm({ ...form, departmentId: event.target.value })
                  }
                >
                  <option value="">Departmansız</option>
                  {payload.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Unvan
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                />
              </label>
              <label>
                Telefon
                <input
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="access-dialog-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setAdding(false)}
              >
                Vazgeç
              </button>
              <button className="btn primary" disabled={busy === "new"}>
                {busy === "new" ? "Ekleniyor…" : "Pasif olarak ekle"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

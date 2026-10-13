import {
  DEFAULT_ROLES,
  clonePermissionMap,
  AccessEmployee,
  AccessDepartment,
} from "../../../shared/access";
export const accessDemoKey = "xre-access-demo-v1";
export function accessDemoFixture() {
  try {
    const x = JSON.parse(localStorage.getItem(accessDemoKey) || "null");
    if (x?.roles) return x;
  } catch {}
  const stamp = new Date().toISOString();
  const departments: AccessDepartment[] = [
    { id: "d-xre", name: "XRE Real Estate", active: true },
    { id: "d-sales", name: "Satış & Portföy", parentId: "d-xre", active: true },
    {
      id: "d-ops",
      name: "Operasyon & İletişim",
      parentId: "d-xre",
      active: true,
    },
    { id: "d-partners", name: "XRE Partners", parentId: "d-xre", active: true },
  ];
  const employees: AccessEmployee[] = [
    {
      id: "e-zeynep",
      name: "Zeynep Kaya",
      openId: "demo-zeynep",
      email: "zeynep@example.test",
      phone: "",
      departmentId: "d-sales",
      roleId: "manager",
      title: "Satış yöneticisi",
      active: true,
    },
    {
      id: "e-ali",
      name: "Ali Kemal",
      openId: "demo-ali",
      email: "ali@example.test",
      phone: "",
      departmentId: "d-sales",
      roleId: "sales",
      title: "Gayrimenkul danışmanı",
      active: true,
    },
    {
      id: "e-merve",
      name: "Merve Yılmaz",
      openId: "demo-merve",
      email: "merve@example.test",
      phone: "",
      departmentId: "d-ops",
      roleId: "sales",
      title: "İletişim danışmanı",
      active: true,
    },
    {
      id: "e-deniz",
      name: "Deniz Demir",
      openId: "demo-deniz",
      email: "deniz@example.test",
      phone: "",
      departmentId: "d-partners",
      roleId: "observer",
      title: "Partner",
      active: false,
    },
  ];
  return {
    roles: DEFAULT_ROLES.map((r) => ({
      ...r,
      grants: clonePermissionMap(r.grants),
    })),
    employees: employees.map((e) => ({
      ...e,
      createdAt: stamp,
      updatedAt: stamp,
    })),
    departments,
  };
}

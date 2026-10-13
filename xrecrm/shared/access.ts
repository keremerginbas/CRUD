export const ACCESS_MODULES = [
  "crm",
  "contacts",
  "companies",
  "tasks",
  "calendar",
  "feed",
  "whatsapp",
  "calls",
  "reports",
  "ai",
  "integrations",
  "automations",
  "users",
  "access",
  "departments",
  "worktime",
] as const;

export type AccessModule = (typeof ACCESS_MODULES)[number];
export type PermissionScope = "all" | "own";
export interface ModulePermission {
  read: boolean;
  write: boolean;
  scope: PermissionScope;
}
export type PermissionMap = Record<AccessModule, ModulePermission>;

export interface AccessRole {
  id: string;
  name: string;
  description: string;
  locked: boolean;
  grants: PermissionMap;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccessEmployee {
  id: string;
  name: string;
  email: string;
  openId: string;
  departmentId: string;
  roleId: string;
  active: boolean;
  title: string;
  phone: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccessDepartment {
  id: string;
  name: string;
  parentId?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const ACCESS_MODULE_LABELS: Record<AccessModule, string> = {
  crm: "CRM fırsatları",
  contacts: "Kişiler",
  companies: "Şirketler",
  tasks: "Görevler",
  calendar: "Takvim",
  feed: "Akış",
  whatsapp: "WhatsApp",
  calls: "Aramalar",
  reports: "Raporlar",
  ai: "Yapay zekâ",
  integrations: "Entegrasyonlar",
  automations: "Otomasyonlar",
  users: "Ekip üyeleri",
  access: "Erişim ve roller",
  departments: "Departmanlar",
  worktime: "Mesai",
};

function grants(
  enabled: Partial<Record<AccessModule, Partial<ModulePermission>>>,
): PermissionMap {
  const result = {} as PermissionMap;
  for (const module of ACCESS_MODULES) {
    const value = enabled[module] || {};
    result[module] = {
      read: Boolean(value.read),
      write: Boolean(value.write),
      scope: value.scope === "all" ? "all" : "own",
    };
  }
  return result;
}

const all = (
  write = true,
): Partial<Record<AccessModule, Partial<ModulePermission>>> =>
  Object.fromEntries(
    ACCESS_MODULES.map((module) => [
      module,
      { read: true, write, scope: "all" },
    ]),
  ) as Partial<Record<AccessModule, Partial<ModulePermission>>>;

export const DEFAULT_ROLES: readonly AccessRole[] = [
  {
    id: "owner",
    name: "Sahip",
    description: "Çalışma alanının tam yetkili sahibi.",
    locked: true,
    grants: grants(all(true)),
  },
  {
    id: "manager",
    name: "Yönetici",
    description: "Ekip ve operasyonları yöneten güvenilir kullanıcı.",
    locked: false,
    grants: grants({
      crm: { read: true, write: true, scope: "all" },
      contacts: { read: true, write: true, scope: "all" },
      companies: { read: true, write: true, scope: "all" },
      tasks: { read: true, write: true, scope: "all" },
      calendar: { read: true, write: true, scope: "all" },
      feed: { read: true, write: true, scope: "all" },
      whatsapp: { read: true, write: true, scope: "all" },
      calls: { read: true, write: true, scope: "all" },
      reports: { read: true, write: false, scope: "all" },
      ai: { read: true, write: true, scope: "all" },
      integrations: { read: true, write: false, scope: "all" },
      automations: { read: true, write: true, scope: "all" },
      users: { read: true, write: true, scope: "all" },
      departments: { read: true, write: true, scope: "all" },
      worktime: { read: true, write: true, scope: "all" },
    }),
  },
  {
    id: "sales",
    name: "Satış",
    description: "Kendi müşteri ve fırsatlarını yöneten satış kullanıcısı.",
    locked: false,
    grants: grants({
      crm: { read: true, write: true, scope: "own" },
      contacts: { read: true, write: true, scope: "own" },
      companies: { read: true, write: true, scope: "own" },
      tasks: { read: true, write: true, scope: "own" },
      calendar: { read: true, write: true, scope: "own" },
      feed: { read: true, write: true, scope: "own" },
      whatsapp: { read: true, write: true, scope: "own" },
      calls: { read: true, write: true, scope: "own" },
      ai: { read: true, write: true, scope: "own" },
      reports: { read: true, write: false, scope: "own" },
      worktime: { read: true, write: true, scope: "own" },
    }),
  },
  {
    id: "observer",
    name: "Gözlemci",
    description: "Kendi kayıtlarını okuyabilen, salt okunur kullanıcı.",
    locked: false,
    grants: grants({
      crm: { read: true, write: false, scope: "own" },
      contacts: { read: true, write: false, scope: "own" },
      companies: { read: true, write: false, scope: "own" },
      tasks: { read: true, write: false, scope: "own" },
      calendar: { read: true, write: false, scope: "own" },
      feed: { read: true, write: false, scope: "own" },
      whatsapp: { read: true, write: false, scope: "own" },
      calls: { read: true, write: false, scope: "own" },
      reports: { read: true, write: false, scope: "own" },
      ai: { read: true, write: false, scope: "own" },
      worktime: { read: true, write: false, scope: "own" },
    }),
  },
] as const;

export function emptyPermissionMap(): PermissionMap {
  return grants({});
}

export function clonePermissionMap(
  value?: Partial<PermissionMap>,
): PermissionMap {
  const result = emptyPermissionMap();
  for (const module of ACCESS_MODULES) {
    const candidate = value?.[module];
    if (!candidate) continue;
    result[module] = {
      read: Boolean(candidate.read),
      write: Boolean(candidate.write),
      scope: candidate.scope === "all" ? "all" : "own",
    };
  }
  return result;
}

export function defaultRole(id: string): AccessRole | undefined {
  const role = DEFAULT_ROLES.find((item) => item.id === id);
  return role
    ? { ...role, grants: clonePermissionMap(role.grants) }
    : undefined;
}

export function canRead(
  permissions: PermissionMap | undefined,
  module: AccessModule,
): boolean {
  return Boolean(permissions?.[module]?.read);
}

export function canWrite(
  permissions: PermissionMap | undefined,
  module: AccessModule,
): boolean {
  return Boolean(permissions?.[module]?.write);
}

/* ----------------------------------------------------------------
   Rol Bazlı Yetkilendirme (RBAC)
   Tek kaynak: hangi rol hangi sayfayı görebilir / ne yapabilir.
-----------------------------------------------------------------*/

export type Role =
  | "admin"
  | "sales_manager"
  | "sales_rep"
  | "call_center"
  | "accountant"
  | "user";

// Uygulamadaki yetenekler (izinler)
export type Permission =
  | "view_dashboard"
  | "view_leads"
  | "create_leads"
  | "delete_leads"
  | "view_kanban"
  | "move_leads"        // kanban'da statü değiştirme
  | "view_activities"
  | "view_communications"
  | "make_calls"        // arama başlatma (NetGSM/WhatCRM)
  | "view_reports"
  | "manage_users"      // admin paneli
  | "view_all_data"     // tüm kullanıcıların datasını görme (yoksa sadece kendi)
  | "manage_settings";  // entegrasyon/webhook ayarları

const ALL: Permission[] = [
  "view_dashboard", "view_leads", "create_leads", "delete_leads",
  "view_kanban", "move_leads", "view_activities", "view_communications",
  "make_calls", "view_reports", "manage_users", "view_all_data", "manage_settings",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Yönetici: her şey
  admin: ALL,

  // Satış Müdürü: ekip + raporlar, kullanıcı yönetimi ve ayarlar hariç; tüm datayı görür
  sales_manager: [
    "view_dashboard", "view_leads", "create_leads", "delete_leads",
    "view_kanban", "move_leads", "view_activities", "view_communications",
    "make_calls", "view_reports", "view_all_data",
  ],

  // Satış Temsilcisi (satışçı): kendi datası, kanban dahil; rapor yok
  sales_rep: [
    "view_dashboard", "view_leads", "create_leads",
    "view_kanban", "move_leads", "view_activities", "view_communications", "make_calls",
  ],

  // Çağrı Merkezi: kendi datası; Kanban dahil, rapor/silme YOK
  call_center: [
    "view_dashboard", "view_leads", "view_kanban", "move_leads",
    "view_activities", "view_communications", "make_calls",
  ],

  // Muhasebe: dashboard + raporlar
  accountant: [
    "view_dashboard", "view_reports",
  ],

  // Standart kullanıcı: sadece dashboard
  user: ["view_dashboard"],
};

// Her rota için gereken izin
export const PATH_PERMISSION: Record<string, Permission> = {
  "/": "view_dashboard",
  "/leads": "view_leads",
  "/kanban": "view_kanban",
  "/kanban-bitrix": "view_kanban",
  "/activities": "view_activities",
  "/communications": "view_communications",
  "/reports": "view_reports",
  "/admin": "manage_users",
  "/integrations": "manage_settings",
  "/automations": "manage_settings",
};

export function hasPermission(role: Role | string | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as Role];
  return !!perms && perms.includes(perm);
}

export function canAccessPath(role: Role | string | undefined | null, path: string): boolean {
  const perm = PATH_PERMISSION[path];
  if (!perm) return true; // tanımsız rota → engelleme
  return hasPermission(role, perm);
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Yönetici",
  sales_manager: "Satış Müdürü",
  sales_rep: "Satış Temsilcisi",
  call_center: "Çağrı Merkezi",
  accountant: "Muhasebe",
  user: "Kullanıcı",
};
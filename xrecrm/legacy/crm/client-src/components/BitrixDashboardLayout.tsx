/**
 * Bitrix24 Benzeri Dashboard Layout - PREMIUM DARK THEME
 * Glassmorphism, animasyonlar, neon efektleri
 */

import { useState } from "react";
import { useAuth } from "../_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Menu,
  X,
  LayoutGrid,
  Users,
  Activity,
  MessageSquare,
  BarChart3,
  Settings,
  LogOut,
  ChevronDown,
  Zap,
  Bell,
  Search,
} from "lucide-react";

interface BitrixDashboardLayoutProps {
  children: React.ReactNode;
}

export default function BitrixDashboardLayout({ children }: BitrixDashboardLayoutProps) {
  const { user, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const menuItems = [
    {
      label: "CRM",
      icon: LayoutGrid,
      submenu: [
        { label: "Kanban Board", href: "/kanban-bitrix", icon: LayoutGrid },
        { label: "Müşteriler", href: "/leads", icon: Users },
      ],
    },
    {
      label: "İletişim",
      icon: MessageSquare,
      submenu: [
        { label: "İletişim Geçmişi", href: "/communications", icon: MessageSquare },
      ],
    },
    {
      label: "Aktiviteler",
      icon: Activity,
      submenu: [
        { label: "Tüm Aktiviteler", href: "/activities", icon: Activity },
      ],
    },
    {
      label: "Raporlar",
      icon: BarChart3,
      submenu: [
        { label: "Dashboard", href: "/reports", icon: BarChart3 },
      ],
    },
  ];

  const [expandedMenu, setExpandedMenu] = useState<string | null>("CRM");

  const activeLabel = menuItems.find((item) => expandedMenu === item.label)?.label || "CRM";

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "linear-gradient(160deg, oklch(0.118 0.012 255) 0%, oklch(0.128 0.016 260) 50%, oklch(0.115 0.010 245) 100%)",
        color: "oklch(0.88 0.008 240)",
      }}
    >
      {/* ============ SIDEBAR ============ */}
      <div
        className="flex flex-col overflow-hidden shrink-0"
        style={{
          width: sidebarOpen ? "260px" : "72px",
          background: "linear-gradient(180deg, oklch(0.148 0.016 255) 0%, oklch(0.130 0.012 255) 100%)",
          borderRight: "1px solid oklch(1 0 0 / 0.06)",
          boxShadow: "4px 0 32px oklch(0 0 0 / 0.4)",
          transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Logo Area */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: "1.25rem 1rem",
            borderBottom: "1px solid oklch(1 0 0 / 0.06)",
            minHeight: "72px",
          }}
        >
          {sidebarOpen && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: "linear-gradient(135deg, oklch(0.62 0.20 255), oklch(0.52 0.24 270))",
                  boxShadow: "0 4px 16px oklch(0.62 0.20 255 / 0.4)",
                }}
              >
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1
                  className="font-bold truncate"
                  style={{
                    fontSize: "1rem",
                    letterSpacing: "-0.025em",
                    background: "linear-gradient(135deg, oklch(0.85 0.08 255), oklch(0.75 0.12 255))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  CRM Pro
                </h1>
                <p style={{ fontSize: "0.6875rem", color: "oklch(0.55 0.015 250)", marginTop: "1px" }}>
                  Gayrimenkul
                </p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center justify-center rounded-xl shrink-0"
            style={{
              width: "36px",
              height: "36px",
              background: "oklch(1 0 0 / 0.05)",
              border: "1px solid oklch(1 0 0 / 0.08)",
              color: "oklch(0.60 0.015 250)",
              transition: "all 0.2s ease",
              cursor: "pointer",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.10)";
              (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.88 0.008 240)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.05)";
              (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.60 0.015 250)";
            }}
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav
          className="flex-1 overflow-y-auto"
          style={{ padding: "0.75rem 0.625rem", gap: "0.25rem", display: "flex", flexDirection: "column" }}
        >
          {menuItems.map((item, idx) => {
            const isExpanded = expandedMenu === item.label;
            const hasActiveChild = item.submenu.some(s => s.href === location);

            return (
              <div key={item.label}>
                <button
                  onClick={() => setExpandedMenu(isExpanded ? null : item.label)}
                  className="w-full flex items-center justify-between rounded-xl"
                  style={{
                    padding: sidebarOpen ? "0.625rem 0.875rem" : "0.625rem",
                    justifyContent: sidebarOpen ? "space-between" : "center",
                    background: isExpanded || hasActiveChild
                      ? "linear-gradient(135deg, oklch(0.62 0.20 255 / 0.2), oklch(0.52 0.24 270 / 0.15))"
                      : "transparent",
                    color: isExpanded || hasActiveChild
                      ? "oklch(0.78 0.12 255)"
                      : "oklch(0.65 0.015 250)",
                    border: isExpanded || hasActiveChild
                      ? "1px solid oklch(0.62 0.20 255 / 0.2)"
                      : "1px solid transparent",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    cursor: "pointer",
                    marginBottom: "2px",
                  }}
                  onMouseEnter={e => {
                    if (!isExpanded && !hasActiveChild) {
                      (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.06)";
                      (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.88 0.008 240)";
                      (e.currentTarget as HTMLButtonElement).style.transform = "translateX(3px)";
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isExpanded && !hasActiveChild) {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                      (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0.015 250)";
                      (e.currentTarget as HTMLButtonElement).style.transform = "translateX(0)";
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <item.icon
                      className="shrink-0"
                      style={{
                        width: "18px",
                        height: "18px",
                        color: isExpanded || hasActiveChild ? "oklch(0.72 0.16 255)" : "currentColor",
                        filter: isExpanded || hasActiveChild
                          ? "drop-shadow(0 0 6px oklch(0.62 0.20 255 / 0.5))"
                          : "none",
                      }}
                    />
                    {sidebarOpen && (
                      <span style={{ fontSize: "0.875rem", fontWeight: 500, letterSpacing: "-0.01em" }}>
                        {item.label}
                      </span>
                    )}
                  </div>
                  {sidebarOpen && (
                    <ChevronDown
                      style={{
                        width: "14px",
                        height: "14px",
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s ease",
                        opacity: 0.6,
                      }}
                    />
                  )}
                </button>

                {/* Submenu */}
                {sidebarOpen && isExpanded && (
                  <div
                    style={{
                      marginLeft: "1rem",
                      marginTop: "0.25rem",
                      marginBottom: "0.25rem",
                      paddingLeft: "0.875rem",
                      borderLeft: "1.5px solid oklch(0.62 0.20 255 / 0.2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    {item.submenu.map((subitem) => {
                      const isActive = location === subitem.href;
                      return (
                        <button
                          key={subitem.label}
                          onClick={() => navigate(subitem.href)}
                          className="w-full text-left rounded-lg"
                          style={{
                            padding: "0.5rem 0.75rem",
                            fontSize: "0.8125rem",
                            fontWeight: isActive ? 600 : 400,
                            background: isActive
                              ? "linear-gradient(135deg, oklch(0.62 0.20 255), oklch(0.52 0.24 270))"
                              : "transparent",
                            color: isActive ? "white" : "oklch(0.60 0.015 250)",
                            boxShadow: isActive ? "0 2px 12px oklch(0.62 0.20 255 / 0.35)" : "none",
                            transition: "all 0.15s ease",
                            cursor: "pointer",
                            letterSpacing: "-0.005em",
                          }}
                          onMouseEnter={e => {
                            if (!isActive) {
                              (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.06)";
                              (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.88 0.008 240)";
                            }
                          }}
                          onMouseLeave={e => {
                            if (!isActive) {
                              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                              (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.60 0.015 250)";
                            }
                          }}
                        >
                          {subitem.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User Profile */}
        {sidebarOpen && (
          <div
            style={{
              padding: "0.75rem",
              borderTop: "1px solid oklch(1 0 0 / 0.06)",
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-full flex items-center gap-3 rounded-xl"
                  style={{
                    padding: "0.625rem 0.75rem",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                    background: "transparent",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.06)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  <div
                    className="flex items-center justify-center rounded-full shrink-0"
                    style={{
                      width: "36px",
                      height: "36px",
                      background: "linear-gradient(135deg, oklch(0.62 0.20 255), oklch(0.52 0.24 270))",
                      boxShadow: "0 2px 8px oklch(0.62 0.20 255 / 0.35)",
                      fontSize: "0.875rem",
                      fontWeight: 700,
                      color: "white",
                    }}
                  >
                    {user?.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <p style={{ fontSize: "0.875rem", fontWeight: 600, letterSpacing: "-0.01em", color: "oklch(0.88 0.008 240)" }} className="truncate">
                      {user?.name}
                    </p>
                    <p style={{ fontSize: "0.6875rem", color: "oklch(0.55 0.015 250)" }} className="truncate mt-0.5">
                      {user?.email}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                style={{
                  background: "oklch(0.175 0.016 255)",
                  border: "1px solid oklch(1 0 0 / 0.08)",
                  boxShadow: "0 16px 48px oklch(0 0 0 / 0.5)",
                }}
              >
                <DropdownMenuItem
                  style={{ color: "oklch(0.75 0.015 250)", cursor: "pointer" }}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Ayarlar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={logout}
                  style={{ color: "oklch(0.65 0.22 22)", cursor: "pointer" }}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Çıkış Yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* ============ MAIN CONTENT ============ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: "0 1.5rem",
            height: "72px",
            background: "linear-gradient(90deg, oklch(0.155 0.016 255) 0%, oklch(0.138 0.012 255) 100%)",
            borderBottom: "1px solid oklch(1 0 0 / 0.06)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 4px 24px oklch(0 0 0 / 0.3)",
          }}
        >
          <div>
            <h2
              className="font-bold"
              style={{
                fontSize: "1.375rem",
                letterSpacing: "-0.03em",
                background: "linear-gradient(135deg, oklch(0.88 0.008 240), oklch(0.78 0.06 255))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {activeLabel}
            </h2>
            <p style={{ fontSize: "0.75rem", color: "oklch(0.55 0.015 250)", marginTop: "2px" }}>
              Müşteri ilişkileri yönetim sistemi
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div
              className="flex items-center gap-2 rounded-xl"
              style={{
                padding: "0.5rem 0.875rem",
                background: "oklch(1 0 0 / 0.05)",
                border: "1px solid oklch(1 0 0 / 0.08)",
                color: "oklch(0.55 0.015 250)",
                fontSize: "0.8125rem",
                cursor: "pointer",
                transition: "all 0.2s ease",
                minWidth: "160px",
              }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span>Ara...</span>
            </div>

            {/* Notifications */}
            <button
              className="relative flex items-center justify-center rounded-xl"
              style={{
                width: "38px",
                height: "38px",
                background: "oklch(1 0 0 / 0.05)",
                border: "1px solid oklch(1 0 0 / 0.08)",
                color: "oklch(0.65 0.015 250)",
                transition: "all 0.2s ease",
                cursor: "pointer",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.10)";
                (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.88 0.008 240)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.05)";
                (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0.015 250)";
              }}
            >
              <Bell className="w-4 h-4" />
              <span
                className="absolute"
                style={{
                  top: "8px",
                  right: "8px",
                  width: "7px",
                  height: "7px",
                  background: "oklch(0.65 0.22 22)",
                  borderRadius: "50%",
                  border: "1.5px solid oklch(0.155 0.016 255)",
                }}
              />
            </button>

            {/* Settings */}
            <button
              className="flex items-center justify-center rounded-xl"
              style={{
                width: "38px",
                height: "38px",
                background: "oklch(1 0 0 / 0.05)",
                border: "1px solid oklch(1 0 0 / 0.08)",
                color: "oklch(0.65 0.015 250)",
                transition: "all 0.2s ease",
                cursor: "pointer",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.10)";
                (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.88 0.008 240)";
                (e.currentTarget as HTMLButtonElement).style.transform = "rotate(45deg)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.05)";
                (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.65 0.015 250)";
                (e.currentTarget as HTMLButtonElement).style.transform = "rotate(0deg)";
              }}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div
          className="flex-1 overflow-auto"
          style={{
            background: "transparent",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

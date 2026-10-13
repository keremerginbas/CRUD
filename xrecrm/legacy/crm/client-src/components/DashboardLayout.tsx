import { useAuth } from "../_core/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { getLoginUrl } from "../const";
import { useIsMobile } from "../hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Users,
  TrendingUp,
  MessageSquare,
  BarChart3,
  Activity,
  Zap,
  Sun,
  Moon,
  Kanban,
  Shield,
  UserCircle,
  Webhook,
} from "lucide-react";
import { canAccessPath } from "../lib/permissions";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { useTheme } from "../contexts/ThemeContext";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Leads", path: "/leads" },
  { icon: TrendingUp, label: "Kanban", path: "/kanban" },
  { icon: Activity, label: "Aktiviteler", path: "/activities" },
  { icon: MessageSquare, label: "İletişim", path: "/communications" },
  { icon: BarChart3, label: "Raporlar", path: "/reports" },
  { icon: Shield, label: "Yönetim", path: "/admin" },
  { icon: Webhook, label: "Entegrasyonlar", path: "/integrations" },
  { icon: Zap, label: "Otomasyon", path: "/automations" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{
          background: "linear-gradient(160deg, oklch(0.975 0.008 240) 0%, oklch(0.965 0.012 255) 50%, oklch(0.970 0.006 220) 100%)"
        }}
      >
        <div
          className="flex flex-col items-center gap-8 p-10 max-w-md w-full rounded-2xl border"
          style={{
            background: "oklch(1 0 0 / 0.7)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderColor: "oklch(1 0 0 / 0.3)",
            boxShadow: "0 24px 80px oklch(0 0 0 / 0.10), 0 0 0 1px oklch(1 0 0 / 0.05)",
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))",
                boxShadow: "0 8px 24px oklch(0.45 0.18 255 / 0.35)",
              }}
            >
              <Zap className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight" style={{ letterSpacing: "-0.03em" }}>
                CRM'e Hoş Geldiniz
              </h1>
              <p className="text-sm mt-2" style={{ color: "oklch(0.52 0.015 250)" }}>
                Devam etmek için giriş yapmanız gerekmektedir.
              </p>
            </div>
          </div>
          <Button
            onClick={() => {
              window.location.href = "/api/dev-login";
            }}
            size="lg"
            className="w-full"
            style={{
              background: "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))",
              boxShadow: "0 4px 20px oklch(0.45 0.18 255 / 0.35)",
              border: "none",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Giriş Yap
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <style>{`
        .app-bg{position:relative;overflow:hidden}
        .app-bg-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
        .app-bg-veil{position:absolute;inset:0;z-index:0;
          background:
            radial-gradient(1000px 600px at 0% -10%, rgba(47,107,255,.10), transparent 55%),
            radial-gradient(900px 560px at 100% -4%, rgba(124,92,255,.08), transparent 52%),
            linear-gradient(180deg, rgba(245,248,253,.52) 0%, rgba(240,244,250,.76) 55%, rgba(235,239,247,.9) 100%);
          -webkit-backdrop-filter:blur(3px) saturate(1.05);backdrop-filter:blur(3px) saturate(1.05);}
        .app-bg-inner{position:relative;z-index:1;padding:1.75rem 1.5rem 2.5rem;min-height:calc(100vh - 4rem)}
        :root.dark .app-bg-veil{background:linear-gradient(180deg, rgba(10,15,28,.62), rgba(8,12,22,.82))}
        @media (prefers-reduced-motion: reduce){.app-bg-video{display:none}}
      `}</style>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          {/* Sidebar Header */}
          <SidebarHeader
            className="h-16 justify-center"
            style={{ borderBottom: "1px solid var(--sidebar-border)" }}
          >
            <div className="flex items-center gap-3 px-2 w-full">
              <button
                onClick={toggleSidebar}
                className="h-9 w-9 flex items-center justify-center rounded-xl transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                style={{
                  background: "transparent",
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--sidebar-accent)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.05)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                }}
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4" style={{ color: "var(--muted-foreground)" }} />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center min-w-0">
                  <img
                    src="/logo.png"
                    alt="X Real Estate Beştepe"
                    style={{ height: "34px", width: "auto", objectFit: "contain" }}
                  />
                </div>
              ) : (
                <img
                    />
              )}
            </div>
          </SidebarHeader>

          {/* Sidebar Content */}
          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-2 gap-1">
              {menuItems.filter(item => canAccessPath(user?.role, item.path)).map((item, index) => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-10 transition-all font-medium"
                      style={{
                        animationDelay: `${index * 40}ms`,
                      }}
                    >
                      <item.icon
                        className="h-4 w-4 shrink-0"
                        style={{
                          color: isActive ? "white" : "var(--muted-foreground)",
                          transition: "color 0.2s ease",
                        }}
                      />
                      <span
                        style={{
                          fontSize: "0.875rem",
                          fontWeight: isActive ? 600 : 500,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {item.label}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          {/* Sidebar Footer */}
          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-3 rounded-xl px-2 py-2 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center"
                  style={{
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--sidebar-accent)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    {(user as any)?.avatarUrl && <AvatarImage src={(user as any).avatarUrl} alt={user?.name || ""} />}
                    <AvatarFallback
                      style={{
                        background: "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))",
                        color: "white",
                        fontWeight: 700,
                        fontSize: "0.8125rem",
                      }}
                    >
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p
                      className="truncate leading-none"
                      style={{ fontSize: "0.875rem", fontWeight: 600, letterSpacing: "-0.01em" }}
                    >
                      {user?.name || "-"}
                    </p>
                    <p
                      className="truncate mt-1"
                      style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}
                    >
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={() => setLocation("/profile")}
                  className="cursor-pointer"
                >
                  <UserCircle className="mr-2 h-4 w-4" />
                  <span>Profilim</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => { logout(); setTimeout(() => { window.location.href = "/login"; }, 300); }}
                  className="cursor-pointer"
                  style={{ color: "var(--destructive)" }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Çıkış Yap</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* Resize Handle */}
        <div
          className={`absolute top-0 right-0 w-1.5 h-full transition-all ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{
            zIndex: 50,
            cursor: "col-resize",
            background: isResizing ? "var(--primary)" : "transparent",
            transition: "background 0.2s ease",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLDivElement).style.background = "var(--primary)";
            (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 8px var(--primary-glow)";
          }}
          onMouseLeave={e => {
            if (!isResizing) {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
              (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
            }
          }}
        />
      </div>

      <SidebarInset>
        {/* Top Bar */}
        <div
          className="crm-topbar flex h-16 items-center justify-between px-8 sticky top-[30px]   z-40"
          style={{
            background: "rgba(255,255,255,0.88)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            boxShadow: "0 1px 20px rgba(16,24,40,0.07)",
          }}
        >
          <div className="flex items-center gap-2">
            {isMobile && (
              <SidebarTrigger
                className="h-9 w-9 rounded-xl"
                style={{ background: "var(--muted)" }}
              />
            )}
            <span
              className="font-semibold"
              style={{ fontSize: "0.9375rem", letterSpacing: "-0.02em", color: "var(--foreground)" }}
            >
              {activeMenuItem?.label ?? "CRM"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Bitrix CRM Link */}
            <button
              onClick={() => setLocation("/kanban-bitrix")}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5"
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                background: "linear-gradient(135deg, oklch(0.48 0.20 255 / 0.10), oklch(0.42 0.22 270 / 0.10))",
                border: "1px solid oklch(0.48 0.20 255 / 0.25)",
                color: "oklch(0.48 0.20 255)",
                transition: "all 0.2s ease",
                cursor: "pointer",
                letterSpacing: "-0.01em",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))";
                (e.currentTarget as HTMLButtonElement).style.color = "white";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px oklch(0.45 0.18 255 / 0.35)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, oklch(0.48 0.20 255 / 0.10), oklch(0.42 0.22 270 / 0.10))";
                (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.48 0.20 255)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
              }}
            >
              <Kanban className="w-3.5 h-3.5" />
              Bitrix CRM
            </button>
            {/* Theme Toggle */}
            {toggleTheme && (
              <button
                onClick={toggleTheme}
                className="flex items-center justify-center rounded-xl"
                style={{
                  width: "36px",
                  height: "36px",
                  background: "var(--muted)",
                  border: "1px solid var(--border)",
                  color: "var(--muted-foreground)",
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--accent)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--foreground)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.05)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--muted)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--muted-foreground)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                }}
                title={isDark ? "Açık Tema" : "Koyu Tema"}
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
        <main className="flex-1 app-bg">
          <video className="app-bg-video" autoPlay muted loop playsInline poster="/bg-poster.jpg">
            <source src="/bg.mp4" type="video/mp4" />
          </video>
          <div className="app-bg-veil" aria-hidden />
          <div className="app-bg-inner">{children}</div>
        </main>
      </SidebarInset>
    </>
  );
}
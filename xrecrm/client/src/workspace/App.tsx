import { ThemeProvider, ThemeButton } from "./components/ThemePreferences";
import { CustomerCallDialog } from "./components/LeadQuickActions";
import "./communication.css";
import "./crm-upgrade.css";
import WorktimeMini from "./components/WorktimeMini";
import type { AccessModule } from "../../../shared/access";
import AppointmentNotifications from "./components/AppointmentNotifications";
import IncomingCall from "./components/IncomingCall";
import { useState, useEffect, lazy, Suspense } from "react";
import {
  LayoutDashboard,
  Users,
  Columns3,
  MessageCircle,
  Phone,
  Radio,
  Workflow,
  Webhook,
  Link2,
  Blocks,
  Settings,
  Search,
  Bell,
  ChevronDown,
  Plus,
  ArrowUpRight,
  Menu,
  X,
  PanelLeftClose,
  HelpCircle,
  Command,
  LogIn,
  ShieldCheck,
  Check,
  Activity,
  Clock,
  ExternalLink,
  CalendarDays,
  CheckSquare,
  Building2,
  MessagesSquare,
  BarChart3,
  ContactRound,
  Sparkles,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { StoreProvider, useStore } from "./store";
import { Lead, Stage } from "./data";
import { Avatar, Badge, Modal, PageTitle } from "./components/ui";
import {
  AssistantProvider,
  GlobalAssistant,
  useAssistant,
} from "./components/Assistant";
import LeadModal from "./components/LeadModal";
import "./style.css";
import "./bitrix.css";
import "./customer.css";
import LeadDrawer from "./components/LeadDrawer";
import { PREVIEW, currentPath } from "./nav";
import LoginScreen, { QrApprove, type AuthStatus } from "./components/LoginScreen";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const OnlineMeeting = lazy(() => import("./components/OnlineMeeting"));
const CRM = lazy(() => import("./pages/CRM"));
const WhatsApp = lazy(() => import("./pages/WhatsApp"));
const Automations = lazy(() => import("./pages/Automations"));
const Lines = lazy(() => import("./pages/Lines"));
const Integrations = lazy(() => import("./pages/Integrations"));
const Directory = lazy(() => import("./pages/Directory"));
const Work = lazy(() => import("./pages/Work"));
const Feed = lazy(() => import("./pages/Feed"));
const Reports = lazy(() => import("./pages/Reports"));
const AI = lazy(() => import("./pages/AI"));
const N8n = lazy(() => import("./pages/N8n"));
const Access = lazy(() => import("./pages/Access"));
const Employees = lazy(() => import("./pages/Employees"));
const Profile = lazy(() => import("./pages/Profile"));
const DataQuality = lazy(() => import("./pages/DataQuality"));
const Worktime = lazy(() => import("./pages/Worktime"));
const navGroups = [
  {
    label: "ÇALIŞMA ALANI",
    items: [
      ["/", "Genel bakış", LayoutDashboard],
      ["/feed", "Akış", MessagesSquare],
      ["/kanban", "CRM", Columns3],
      ["/activities", "Etkinlikler", CalendarDays],
      ["/contacts", "Kişiler", ContactRound],
      ["/companies", "Şirketler", Building2],
      ["/tasks", "Görevler & projeler", CheckSquare],
      ["/calendar", "Takvim", CalendarDays],
      ["/team", "Ekip dizini", Users],
      ["/employees", "Çalışanlar", Users],
      ["/structure", "Şirket yapısı", Building2],
      ["/worktime", "XRE Mesai", Clock],
      ["/access", "Erişim izinleri", ShieldCheck],
      ["/profile", "Profilim", ContactRound],
      ["/reports", "CRM analitiği", BarChart3],
      ["/data-quality", "Veri kalitesi", ShieldCheck],
      ["/ai", "XRE Asistan", Sparkles],
    ],
  },
  {
    label: "İLETİŞİM MERKEZİ",
    items: [
      ["/whatsapp", "WhatsApp", MessageCircle],
      ["/calls", "Aramalar & Yapay Zekâ", Phone],
      ["/lines", "Hat yönetimi", Radio],
    ],
  },
  {
    label: "İŞ AKIŞLARI",
    items: [
      ["/automations", "Otomasyonlar", Workflow],
      ["/n8n", "n8n iş akışları", Workflow],
      ["/webhooks", "Webhooklar", Webhook],
      ["/integrations", "Entegrasyonlar", Link2],
      ["/apps", "Bitrix aktarımı & uygulamalar", Blocks],
    ],
  },
] as const;
function Workspace() {
  const { data, demo, user, setDemo, loading, request } = useStore();
  const routeModules: Record<string, AccessModule> = {
    "/feed": "feed",
    "/kanban": "crm",
    "/leads": "crm",
    "/activities": "crm",
    "/contacts": "contacts",
    "/companies": "companies",
    "/tasks": "tasks",
    "/calendar": "calendar",
    "/team": "users",
    "/employees": "users",
    "/structure": "departments",
    "/worktime": "worktime",
    "/access": "access",
    "/reports": "reports",
    "/ai": "ai",
    "/whatsapp": "whatsapp",
    "/calls": "calls",
    "/lines": "integrations",
    "/automations": "automations",
    "/n8n": "integrations",
    "/webhooks": "integrations",
    "/integrations": "integrations",
    "/apps": "integrations",
  };
  const permitted = (url: string) =>
    (url === "/data-quality" &&
      Boolean(
        user?.permissions?.crm?.read ||
          user?.permissions?.contacts?.read ||
          user?.permissions?.companies?.read,
      )) ||
    demo ||
    user?.isOwner ||
    (!routeModules[url] && url !== "/data-quality") ||
    Boolean(user?.permissions?.[routeModules[url]]?.read);
  const [path, setPath] = useState(currentPath());
  const [leadModal, setLeadModal] = useState<Lead | undefined | null>(null);
  const [newContext, setNewContext] = useState<{
    stage: Stage;
    pipeline: string;
  }>({ stage: "new", pipeline: "sales" });
  const newLead = (stage: Stage = "new", pipeline = "sales") => {
    setNewContext({ stage, pipeline });
    setLeadModal(undefined);
  };
  const [sidebar, setSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [help, setHelp] = useState(false);
  const [messageLead, setMessageLead] = useState<string | undefined>();
  const [profile, setProfile] = useState(false);
  const [callLead, setCallLead] = useState<string>();
  const [meeting, setMeeting] = useState<{ leadId?: string } | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const navigate = (p: string) => {
    history.pushState({}, "", p);
    setPath(p);
    setSidebar(false);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const pop = () => setPath(currentPath());
    const meetingEvent = (e: Event) =>
      setMeeting((e as CustomEvent).detail || {});
    const callEvent = (e: Event) =>
      setCallLead((e as CustomEvent).detail?.leadId);
    window.addEventListener("xre:meeting", meetingEvent);
    window.addEventListener("xre:call", callEvent);
    window.addEventListener("popstate", pop);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        document
          .querySelector<HTMLInputElement>(".global-search input")
          ?.focus();
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifications(false);
        setLeadModal(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("xre:meeting", meetingEvent);
      window.removeEventListener("xre:call", callEvent);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const name = user?.name || "XRE Ekibi";
  const message = (id: string) => {
    setMessageDraft("");
    setMessageLead(id);
    navigate("/whatsapp");
  };
  const current =
    navGroups
      .flatMap((g) => [...g.items])
      .find(
        (i) =>
          i[0] ===
          (["/leads", "/activities", "/calendar"].includes(path)
            ? "/kanban"
            : path),
      )?.[1] || "Ayarlar";
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  useEffect(() => {
    fetch("/api/auth/status", { credentials: "include" })
      .then((r) => r.json())
      .then((s) => {
        if (!s || typeof s !== "object" || !s.providers) return;
        setAuthStatus(s as AuthStatus);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (loading || user || !authStatus) return;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem("xre-login-dismissed") === "1";
    } catch {
      /* depolama kapalı */
    }
    if (
      !dismissed ||
      authStatus.needsSetup ||
      new URLSearchParams(location.search).has("login_error")
    )
      setAuthOpen(true);
  }, [loading, user, authStatus]);
  const login = () => {
    if (PREVIEW) {
      toast.info(
        "Bu bir önizleme: giriş ve canlı CRM için uygulamayı kendi bilgisayarınızda veya sunucunuzda çalıştırın.",
      );
      return;
    }
    if (authStatus) setAuthOpen(true);
    else
      window.location.href =
        "/api/auth/login?origin=" + encodeURIComponent(window.location.origin);
  };
  const dismissLogin = () => {
    try {
      sessionStorage.setItem("xre-login-dismissed", "1");
    } catch {
      /* depolama kapalı */
    }
    setAuthOpen(false);
  };
  if (path === "/qr-onay" && !authOpen)
    return (
      <QrApprove loggedIn={Boolean(user)} onLogin={() => setAuthOpen(true)} />
    );
  if (authOpen && authStatus && !user)
    return (
      <LoginScreen
        status={authStatus}
        onDemo={dismissLogin}
        onClose={authStatus.needsSetup ? undefined : dismissLogin}
      />
    );
  return (
    <AssistantProvider path={path} leadId={leadModal?.id}>
      <div className="app-shell">
        <aside className={`sidebar ${sidebar ? "open" : ""}`}>
          <div
            className="brand"
            onClick={() => navigate("/")}
            role="button"
            tabIndex={0}
          >
            <img
              src="/xre-crm-logo-white.png"
              alt="XRE CRM"
              className="cx-brand-logo"
            />
            <button
              className="sidebar-close icon-button"
              onClick={() => setSidebar(false)}
              aria-label="Menüyü kapat"
            >
              <X size={17} />
            </button>
          </div>
          <button
            className="workspace-switch"
            onClick={() => setProfile(!profile)}
          >
            <span className="workspace-avatar">X</span>
            <span>
              <strong>XRE Real Estate</strong>
              <small>Çalışma alanı</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <nav aria-label="Çalışma alanı menüsü">
            {navGroups.map((g) => (
              <div className="nav-group" key={g.label}>
                <div className="nav-label">{g.label}</div>
                {g.items
                  .filter(([url]) => permitted(url))
                  .map(([url, label, Icon]) => (
                    <button
                      key={url}
                      className={`nav-item ${(url === "/kanban" ? ["/kanban", "/leads", "/activities", "/calendar"].includes(path) : path === url) ? "active" : ""}`}
                      onClick={() => navigate(url)}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                      {url === "/whatsapp" && (
                        <b className="nav-count">
                          {
                            data.messages.filter(
                              (m) => m.direction === "inbound",
                            ).length
                          }
                        </b>
                      )}
                      {url === "/tasks" && (
                        <b className="nav-count">
                          {data.tasks.filter((t) => t.status !== "done").length}
                        </b>
                      )}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-status">
              <span className="green-dot" />
              <div>
                <strong>
                  {demo ? "Demo çalışma alanı" : "CRM çalışma alanı"}
                </strong>
                <small>
                  {demo
                    ? "Örnek verilerle keşfedin"
                    : "Kimliği doğrulanmış veriler"}
                </small>
              </div>
              <ShieldCheck size={15} />
            </div>
            <button
              className={`nav-item ${path === "/settings" ? "active" : ""}`}
              onClick={() => navigate("/settings")}
            >
              <Settings size={18} />
              <span>Ayarlar</span>
            </button>
            <button className="nav-item" onClick={() => setHelp(true)}>
              <HelpCircle size={18} />
              <span>Yardım & kaynaklar</span>
              <ArrowUpRight size={14} />
            </button>
            <button
              className="user-profile"
              onClick={() => setProfile(!profile)}
            >
              <Avatar name={name} size={34} />
              <span>
                <strong>{name}</strong>
                <small>{user ? "Yetkili kullanıcı" : "Demo görünümü"}</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </aside>
        {sidebar && (
          <div className="sidebar-overlay" onClick={() => setSidebar(false)} />
        )}
        <div className="workspace-main">
          <header className="topbar">
            <button
              className="mobile-menu icon-button"
              onClick={() => setSidebar(true)}
              aria-label="Menüyü aç"
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>Çalışma alanı</span>
              <span>/</span>
              <strong>{current}</strong>
            </div>
            <div className="topbar-actions">
              <ThemeButton />
              <AssistantTopbar />
              <div className="global-search">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Her yerde ara…"
                />
                <kbd>⌘ K</kbd>
                {searchOpen && (
                  <div className="search-results">
                    <div className="search-results-title">
                      {search ? "MÜŞTERİ SONUÇLARI" : "HIZLI ERİŞİM"}
                      <button
                        className="icon-button"
                        onClick={() => setSearchOpen(false)}
                        aria-label="Aramayı kapat"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {search
                      ? data.leads
                          .filter((l) =>
                            `${l.name} ${l.phone} ${l.company}`
                              .toLocaleLowerCase("tr")
                              .includes(search.toLocaleLowerCase("tr")),
                          )
                          .slice(0, 6)
                          .map((l) => (
                            <button
                              key={l.id}
                              onClick={() => {
                                setLeadModal(l);
                                setSearchOpen(false);
                              }}
                            >
                              <Avatar name={l.name} size={27} />
                              <span>
                                {l.name}
                                <small>{l.company}</small>
                              </span>
                              <ArrowUpRight size={14} />
                            </button>
                          ))
                      : [
                          ["/leads", "Müşterilere git"],
                          ["/whatsapp", "WhatsApp gelen kutusu"],
                          ["/integrations", "Entegrasyonları yönet"],
                        ].map(([p, t]) => (
                          <button
                            key={p}
                            onClick={() => {
                              navigate(p);
                              setSearchOpen(false);
                            }}
                          >
                            <ArrowUpRight size={15} />
                            {t}
                          </button>
                        ))}
                    {search &&
                      !data.leads.some((l) =>
                        l.name.toLowerCase().includes(search.toLowerCase()),
                      ) && (
                        <p className="search-empty">
                          Aramanızı telefon veya portföy adıyla
                          daraltabilirsiniz.
                        </p>
                      )}
                  </div>
                )}
              </div>
              <span className="topbar-separator" />
              <button
                className="demo-switch"
                onClick={() => {
                  if (demo && !user) login();
                  else setDemo(!demo);
                }}
              >
                <span className={demo ? "amber-dot" : "green-dot"} />
                {demo ? "Demo modu" : "Canlı CRM"}
                <ChevronDown size={12} />
              </button>
              <AppointmentNotifications
                onLead={(id) =>
                  setLeadModal(data.leads.find((l) => l.id === id) || null)
                }
              />
              <IncomingCall
                onLead={(id) =>
                  setLeadModal(data.leads.find((l) => l.id === id) || null)
                }
              />
              <div className="notification-wrap">
                <button
                  className={`icon-button bell ${notifications ? "selected" : ""}`}
                  onClick={() => setNotifications(!notifications)}
                  aria-label="Bildirimler"
                >
                  <Bell size={19} />
                  {data.events.length > 0 && <i />}
                </button>
                {notifications && (
                  <div className="notification-panel">
                    <h3>
                      Son hareketler<Badge>{data.events.length}</Badge>
                    </h3>
                    {data.events.slice(0, 5).map((e) => (
                      <button
                        key={e.id}
                        onClick={() => {
                          navigate("/webhooks");
                          setNotifications(false);
                        }}
                      >
                        <span className="activity-icon">
                          <Activity size={16} />
                        </span>
                        <span>
                          <strong>{e.title}</strong>
                          <small>{e.detail}</small>
                        </span>
                      </button>
                    ))}
                    <button
                      className="notification-footer"
                      onClick={() => {
                        navigate("/webhooks");
                        setNotifications(false);
                      }}
                    >
                      Tüm olayları görüntüle
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}
              </div>
              <button
                className="top-avatar"
                onClick={() => setProfile(!profile)}
                aria-label="Hesap menüsü"
              >
                <Avatar name={name} size={31} />
              </button>
            </div>
          </header>
          <main
            className={`page-content ${path === "/kanban" ? "kanban-page" : ""}`}
          >
            {!permitted(path) ? (
              <>
                <PageTitle
                  title="Bu modüle erişiminiz yok"
                  description="Çalışma alanı sahibi Erişim izinleri ekranından rolünüzü düzenleyebilir."
                />
                <button
                  className="btn secondary"
                  onClick={() => navigate("/profile")}
                >
                  Profilime git
                </button>
              </>
            ) : path === "/data-quality" ? (
              <DataQuality navigate={navigate} onLead={setLeadModal} />
            ) : path === "/access" ? (
              <Access />
            ) : path === "/employees" || path === "/structure" ? (
              <Employees structure={path === "/structure"} />
            ) : path === "/profile" ? (
              <Profile />
            ) : path === "/worktime" ? (
              <Worktime navigate={navigate} />
            ) : path === "/" ? (
              <Dashboard
                navigate={navigate}
                onLead={setLeadModal}
                onNew={() => newLead()}
              />
            ) : ["/leads", "/kanban", "/activities", "/calendar"].includes(
                path,
              ) ? (
              <CRM
                key={path}
                kanban={path === "/kanban"}
                view={
                  path === "/kanban"
                    ? "kanban"
                    : path === "/leads"
                      ? "list"
                      : path === "/activities"
                        ? "activities"
                        : "calendar"
                }
                onMessage={message}
                navigate={navigate}
                onNewAt={(stage, pipeline) => newLead(stage, pipeline)}
                onLead={setLeadModal}
                onNew={() => newLead()}
              />
            ) : path === "/contacts" ||
              path === "/companies" ||
              path === "/team" ? (
              <Directory
                type={
                  path === "/contacts"
                    ? "contacts"
                    : path === "/companies"
                      ? "companies"
                      : "members"
                }
                onLead={setLeadModal}
                navigate={navigate}
              />
            ) : path === "/tasks" ? (
              <Work onLead={setLeadModal} />
            ) : path === "/feed" ? (
              <Feed onLead={setLeadModal} />
            ) : path === "/ai" ? (
              <AI
                navigate={navigate}
                onLead={(id) =>
                  setLeadModal(data.leads.find((l) => l.id === id) || null)
                }
              />
            ) : path === "/n8n" ? (
              <N8n navigate={navigate} />
            ) : path === "/reports" ? (
              <Reports onLead={setLeadModal} navigate={navigate} />
            ) : path === "/whatsapp" ? (
              <WhatsApp
                initialLead={
                  messageLead ||
                  new URLSearchParams(location.search).get("lead") ||
                  undefined
                }
                initialDraft={messageDraft}
                onDraftConsumed={() => setMessageDraft("")}
                onLead={setLeadModal}
              />
            ) : path === "/automations" ? (
              <Automations />
            ) : path === "/lines" || path === "/calls" ? (
              <Lines calls={path === "/calls"} navigate={navigate} />
            ) : path === "/integrations" ||
              path === "/webhooks" ||
              path === "/apps" ? (
              <Integrations
                webhooks={path === "/webhooks"}
                local={path === "/apps"}
              />
            ) : path === "/settings" ? (
              <>
                <PageTitle
                  eyebrow="ÇALIŞMA ALANI AYARLARI"
                  title="Kontrol sizde."
                  description="Çalışma modunuzu ve güvenli entegrasyon ayarlarınızı yönetin."
                />
                <section className="panel settings-panel">
                  <div className="setting-row">
                    <div>
                      <h3>Veri modu</h3>
                      <p>
                        Demo verileri yalnızca bu tarayıcıda saklanır. Canlı
                        CRM, kimlik doğrulaması ve kalıcı veritabanı kullanır.
                      </p>
                    </div>
                    <button
                      className="btn secondary"
                      onClick={() => (demo && !user ? login() : setDemo(!demo))}
                    >
                      {demo ? "Canlı CRM’ye geç" : "Demo görünümüne geç"}
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>Güvenli entegrasyonlar</h3>
                      <p>
                        WhatsApp, Vapi ve SIP anahtarları yalnızca sunucuda
                        tutulur.
                      </p>
                    </div>
                    <button
                      className="btn secondary"
                      onClick={() => navigate("/integrations")}
                    >
                      Entegrasyonları aç
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>Hesap oturumu</h3>
                      <p>
                        {user
                          ? `${user.name || "Kullanıcı"} olarak giriş yapıldı.`
                          : "Şu anda demo modundasınız. Gerçek veri için giriş gerekir."}
                      </p>
                    </div>
                    <button className="btn primary" onClick={login}>
                      <LogIn size={16} />
                      {user ? "Oturumu doğrula" : "Güvenli giriş"}
                    </button>
                  </div>
                </section>
              </>
            ) : (
              <>
                <PageTitle
                  title="Bu sayfa bulunamadı."
                  description="Çalışma alanınıza geri dönerek devam edebilirsiniz."
                />
                <button className="btn primary" onClick={() => navigate("/")}>
                  Genel bakışa dön
                </button>
              </>
            )}
            <footer className="workspace-footer">
              <span>
                © 2026 XRE CRM <i /> Bağlantıdan fırsata.
              </span>
              <span>
                <span className={demo ? "amber-dot" : "green-dot"} />
                {demo
                  ? "Demo verileri · Gerçek iletişim gönderilmez"
                  : "CRM çalışma alanı"}
              </span>
            </footer>
          </main>
        </div>
        {leadModal === undefined && (
          <LeadModal
            initialStage={newContext.stage}
            initialPipeline={newContext.pipeline}
            onClose={() => setLeadModal(null)}
            onMessage={message}
          />
        )}
        {leadModal && (
          <LeadDrawer
            key={leadModal.id}
            lead={leadModal}
            onClose={() => setLeadModal(null)}
            onMessage={(id) => {
              setLeadModal(null);
              message(id);
            }}
          />
        )}
        {callLead && (
          <CustomerCallDialog
            key={callLead}
            leadId={callLead}
            onClose={() => setCallLead(undefined)}
          />
        )}
        {meeting && (
          <Suspense fallback={null}>
            <OnlineMeeting
              key={meeting.leadId || "new"}
              leadId={meeting.leadId}
              onClose={() => setMeeting(null)}
              onShare={(id, text) => {
                setMessageLead(id);
                setMessageDraft(text);
                navigate("/whatsapp");
              }}
            />
          </Suspense>
        )}
        {profile && (
          <Modal
            title="XRE çalışma alanı"
            subtitle="Güvenli CRM ve iletişim yönetimi"
            onClose={() => setProfile(false)}
          >
            <div className="modal-content profile-modal">
              <Avatar name={name} size={54} />
              <h3>{name}</h3>
              <p>
                {user
                  ? "Kimliği doğrulanmış oturum"
                  : "Demo modunda örnek verileri görüntülüyorsunuz."}
              </p>
              <Badge tone="green">XRE Real Estate</Badge>
              <WorktimeMini
                navigate={(p) => {
                  setProfile(false);
                  navigate(p);
                }}
              />
              <div className="cx-profile-links">
                <ThemeButton />
                <button
                  className="btn secondary"
                  onClick={() => {
                    setProfile(false);
                    navigate("/profile");
                  }}
                >
                  Profilimi düzenle
                </button>
                {permitted("/access") && (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setProfile(false);
                      navigate("/access");
                    }}
                  >
                    <ShieldCheck size={14} />
                    Erişim izinleri
                  </button>
                )}
              </div>
              {user && (
                <button
                  className="text-button"
                  onClick={() =>
                    void request("/api/auth/logout", {}).then(() =>
                      location.reload(),
                    )
                  }
                >
                  Güvenli çıkış
                </button>
              )}
              <button className="btn primary full-width" onClick={login}>
                <LogIn size={16} />
                {loading
                  ? "Oturum kontrol ediliyor…"
                  : user
                    ? "Güvenli oturumu yenile"
                    : "Canlı CRM için giriş yap"}
              </button>
            </div>
          </Modal>
        )}
        {help && (
          <Modal
            title="CRM kullanım rehberi"
            subtitle="İletişim ve satış süreçlerini birlikte yönetin."
            onClose={() => setHelp(false)}
          >
            <div className="modal-content help-content">
              <h3>1. Müşteri ekleyin</h3>
              <p>
                Yeni müşteri düğmesiyle ad, telefon, portföy ve fırsat değerini
                kaydedin.
              </p>
              <h3>2. Aşamalar arasında taşıyın</h3>
              <p>
                Satış Kanbanı’nda kartları sürükleyin. İlgili aşama kuralları
                otomatik tetiklenir.
              </p>
              <h3>3. İletişim kanallarını bağlayın</h3>
              <p>
                Entegrasyonlar bölümünde gerekli güvenli sunucu değişkenlerini
                görebilirsiniz. QR için Evolution API, mesajlaşma için Meta
                Cloud API, telefon için PBX ve Vapi gerekir.
              </p>
              <div className="info-banner slim">
                <ShieldCheck size={17} />
                <p>
                  Demo işlemleri gerçek mesaj veya arama göndermez. Canlı
                  işlemler için doğrulanmış oturum ve sağlayıcı kurulumu
                  gerekir.
                </p>
              </div>
            </div>
          </Modal>
        )}
        <GlobalAssistant
          navigate={navigate}
          onLead={(id) =>
            setLeadModal(data.leads.find((l) => l.id === id) || null)
          }
        />
      </div>
    </AssistantProvider>
  );
}
function AssistantTopbar() {
  const ai = useAssistant();
  return (
    <button
      className="ai-topbar-button"
      onClick={() => ai.setOpen(!ai.open)}
      aria-label="Üst menüden asistanı aç"
    >
      <Sparkles size={15} />
      <span>Asistan</span>
    </button>
  );
}
export default function App() {
  return (
    <StoreProvider>
      <ThemeProvider>
        <Suspense
          fallback={
            <div className="initial-loading">
              <img src="/xre-crm-logo-white.png" alt="XRE CRM" />
              <p>Çalışma alanınız hazırlanıyor…</p>
            </div>
          }
        >
          <Workspace />
        </Suspense>
        <Toaster position="bottom-right" richColors closeButton />
      </ThemeProvider>
    </StoreProvider>
  );
}

import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import NotFound from "./pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Leads from "./pages/Leads";
import Kanban from "./pages/Kanban";
import KanbanBitrix from "./pages/KanbanBitrix";
import LeadDetail from "./pages/LeadDetail";
import Activities from "./pages/Activities";
import Communications from "./pages/Communications";
import Reports from "./pages/Reports";
import AdminPanel from "./pages/AdminPanel";
import Profile from "./pages/Profile";
import Integrations from "./pages/Integrations";
import Automations from "./pages/Automations";
import Login from "./pages/Login";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./_core/hooks/useAuth";
import { useEffect } from "react";

/**
 * AutoTheme: Bitrix rotalarında otomatik koyu tema
 */
function AutoTheme() {
  const [location] = useLocation();
  const { switchable } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    if (location === "/kanban-bitrix") {
      root.classList.add("dark");
    } else if (!switchable) {
      root.classList.remove("dark");
    }
  }, [location, switchable]);

  return null;
}

/**
 * Yükleniyor ekranı (auth kontrol edilirken)
 */
function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#eef2f9" }}>
      <div style={{ width: 40, height: 40, border: "3px solid #cdd8ec", borderTopColor: "#2f6bff", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/**
 * Router — auth kapısı.
 * - Yükleniyorsa: spinner (hiçbir sayfa mount olmaz → korumalı sorgu atılmaz → döngü olmaz)
 * - Giriş yapılmamışsa: SADECE Login render edilir
 * - Giriş yapılmışsa: tüm uygulama
 */
function Router() {
  const { user, loading } = useAuth();
  const [location, navigate] = useLocation();

  // Giriş yapılmışken /login'deyse ana sayfaya al
  useEffect(() => {
    if (!loading && user && location === "/login") {
      navigate("/");
    }
  }, [user, loading, location, navigate]);

  if (loading) return <LoadingScreen />;

  // Giriş yapılmamış → sadece Login (başka hiçbir sayfa mount olmaz)
  if (!user) {
    return <Login />;
  }

  // Giriş yapılmış → normal uygulama
  return (
    <>
      <AutoTheme />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/leads" component={Leads} />
        <Route path="/leads/:id" component={LeadDetail} />
        <Route path="/kanban" component={Kanban} />
        <Route path="/kanban-bitrix" component={KanbanBitrix} />
        <Route path="/activities" component={Activities} />
        <Route path="/communications" component={Communications} />
        <Route path="/reports" component={Reports} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/automations" component={Automations} />
        <Route path="/login" component={Home} />
        <Route path="/profile" component={Profile} />

        <Route path="/admin">
          <ProtectedRoute requiredRoles={["admin"]}>
            <AdminPanel />
          </ProtectedRoute>
        </Route>

        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
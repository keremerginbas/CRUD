import { useAuth } from "@/_core/hooks/useAuth";
import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

type UserRole = "admin" | "sales_manager" | "sales_rep" | "accountant" | "call_center" | "user";

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRoles?: UserRole[];
  fallback?: ReactNode;
}

export function ProtectedRoute({ children, requiredRoles = [], fallback }: ProtectedRouteProps) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) return null; // Yüklenirken hiçbir şey döndürme veya skeleton ekle

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Card className="w-full max-w-md border-red-200 bg-red-50">
          <CardHeader><CardTitle className="text-red-700">Giriş Gerekli</CardTitle></CardHeader>
          <CardContent><p className="text-red-600">Bu sayfaya erişmek için giriş yapmalısınız.</p></CardContent>
        </Card>
      </div>
    );
  }

  const hasRequiredRole = requiredRoles.length === 0 || requiredRoles.includes(user.role as UserRole);

  if (!hasRequiredRole) {
    return fallback || (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600 font-medium">Bu sayfaya erişim yetkiniz bulunmamaktadır.</p>
      </div>
    );
  }

  return <>{children}</>;
}
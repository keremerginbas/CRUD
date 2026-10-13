import { useAuth } from "@/_core/hooks/useAuth";

export function useCanAccess(requiredRoles: string[]) {
  const { user } = useAuth();
  if (!user) return false;
  return requiredRoles.includes(user.role);
}
import { trpc } from "@/lib/trpc";
import { useCallback, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

/**
 * useAuth — sadece şifreli giriş (JWT cookie crm_session).
 * Otomatik yönlendirme YOK: App.tsx içindeki Router kapısı,
 * giriş yoksa Login'i, varsa uygulamayı gösterir. Böylece
 * çift yönlendirme / flicker / döngü olmaz.
 */
export function useAuth(_options?: UseAuthOptions) {
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error) {
      console.error("Logout hata verdi:", error);
    } finally {
      // İstemci tarafı temizlik
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {}
      // Tam sayfa yenileme ile /login'e (state tamamen sıfırlanır)
      window.location.replace("/login");
    }
  }, [logoutMutation, utils]);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    }),
    [meQuery.data, meQuery.error, meQuery.isLoading, logoutMutation.error, logoutMutation.isPending]
  );

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
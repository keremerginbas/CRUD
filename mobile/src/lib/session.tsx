import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, loadToken, setToken, setUnauthorizedHandler } from './api';
import { registerForPush } from './push';
import type { User } from './types';

type Session = {
  ready: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    setUser(await api<User>('/api/me'));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    loadToken()
      .then((t) => (t ? refresh() : undefined))
      .catch(() => logout())
      .finally(() => setReady(true));
  }, [logout, refresh]);

  useEffect(() => {
    if (user) registerForPush().catch((e) => console.warn('Bildirim kaydı başarısız', e));
  }, [user?.id]);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { email, password } });
    await setToken(res.token);
    await refresh();
  };

  return <SessionContext.Provider value={{ ready, user, login, logout, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession SessionProvider dışında kullanıldı');
  return ctx;
}

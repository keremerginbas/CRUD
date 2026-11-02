import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import type { User } from './types';

type Session = {
  ready: boolean;
  me: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);
export const MANAGERS = ['admin', 'broker', 'asistan'];

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<User | null>(null);

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);
  const refresh = useCallback(async () => setMe(await api<User>('/api/me')), []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    (getToken() ? refresh() : Promise.resolve()).catch(logout).finally(() => setReady(true));
  }, [logout, refresh]);

  const login = async (username: string, password: string) => {
    const res = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { email: username, password } });
    setToken(res.token);
    await refresh();
  };

  return <SessionContext.Provider value={{ ready, me, login, logout, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession SessionProvider dışında kullanıldı');
  return ctx;
}

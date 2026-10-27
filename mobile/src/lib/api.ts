import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const API_URL: string = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';
const TOKEN_KEY = 'auth-token';

let token: string | null = null;

export async function loadToken() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}

export async function setToken(value: string | null) {
  token = value;
  if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export const authHeaders = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && token) onUnauthorized();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Beklenmeyen bir hata oluştu', res.status);
  return data as T;
}

export const recordingUrl = (callId: number) => `${API_URL}/api/calls/${callId}/recording`;

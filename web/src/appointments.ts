// Randevu listesi: sayfa ve hatırlatıcı aynı veriyi paylaşır; değişince herkes yeniler
import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { Appointment } from './types';

let list: Appointment[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const appointments = {
  get: () => list,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  async reload() {
    try { list = await api<Appointment[]>('/api/appointments'); emit(); } catch { /* sonraki denemede */ }
  },
  async create(body: Record<string, unknown>) {
    const a = await api<Appointment>('/api/appointments', { method: 'POST', body });
    await appointments.reload();
    return a;
  },
  async update(id: number, body: Record<string, unknown>) {
    const a = await api<Appointment>(`/api/appointments/${id}`, { method: 'PUT', body });
    await appointments.reload();
    return a;
  },
};

export const useAppointments = () => useSyncExternalStore(appointments.subscribe, appointments.get);
// Sunucu UTC "YYYY-MM-DD HH:MM:SS" döner
export const dueDate = (a: Appointment) => new Date(`${a.due_at.replace(' ', 'T')}Z`);

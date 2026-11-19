import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCalendarEvent, IconPhone } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { appointments, dueDate, useAppointments } from '../appointments';
import type { Appointment } from '../types';
import { maskedCall, toastError } from './maskedCall';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const SHOWN_KEY = 'xre-appt-shown';
const shown = (): string[] => { try { return JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]'); } catch { return []; } };
const markShown = (key: string) => { try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown().slice(-200), key])); } catch { /* yok */ } };

// Kısa "ding-dong" (dosya gerektirmez); tarayıcı ses iznini sayfada bir tıklamadan sonra verir
function chime(times = 1) {
  try {
    const ctx = new AudioContext();
    for (let r = 0; r < times; r++) {
      [[880, 0], [660, 0.22]].forEach(([f, t]) => {
        const at = ctx.currentTime + r * 0.9 + t;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at); osc.stop(at + 0.65);
      });
    }
    setTimeout(() => ctx.close().catch(() => {}), times * 900 + 800);
  } catch { /* ses yok */ }
}

function browserNotify(title: string, body: string) {
  try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body, icon: '/icon-192.png' }); } catch { /* yok */ }
}

// Panel açıkken randevudan önce (remind_before dk) bildirim, saatinde "şimdi ara" penceresi
export function AppointmentReminders() {
  const list = useAppointments();
  const [now, setNow] = useState(Date.now());
  const [dueNow, setDueNow] = useState<Appointment | null>(null);

  useEffect(() => {
    appointments.reload();
    const r = setInterval(() => appointments.reload(), 60_000);
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(r); clearInterval(t); };
  }, []);

  useEffect(() => {
    const done = shown();
    for (const a of list) {
      if (a.status !== 'open') continue;
      const due = +dueDate(a);
      const early = `${a.id}:early:${a.due_at}`;
      const onTime = `${a.id}:due:${a.due_at}`;
      if (now >= due && now < due + 2 * 3600e3 && !done.includes(onTime)) {
        markShown(onTime);
        setDueNow(a);
        chime(3);
        browserNotify('Randevu zamanı', `${a.name} aranacak`);
      } else if (a.remind_before > 0 && now >= due - a.remind_before * 60e3 && now < due && !done.includes(early)) {
        markShown(early);
        const title = `Saat ${hhmm(new Date(due))}'de randevunuz var`;
        browserNotify(title, a.name);
        chime(1);
        notifications.show({
          id: early, color: 'xre', autoClose: false, icon: <IconCalendarEvent size={18} />, title,
          message: <Text size="sm">{a.name}{a.note ? ` · ${a.note}` : ''}</Text>,
        });
      }
    }
  }, [list, now]);

  if (!dueNow) return null;
  const a = dueNow;
  const close = () => setDueNow(null);
  const act = async (body: Record<string, unknown>) => { try { await appointments.update(a.id, body); close(); } catch (e) { toastError(e); } };

  return (
    <Modal opened onClose={close} centered radius="lg" withCloseButton={false}>
      <Stack align="center" gap="xs" py="sm">
        <div className="empty-icon"><IconCalendarEvent size={34} stroke={1.5} /></div>
        <Text c="dimmed" size="sm">Randevu zamanı · {hhmm(dueDate(a))}</Text>
        <Text fz="xl" fw={600} tt="uppercase" ta="center">{a.name}</Text>
        {a.note && <Text size="sm" c="dimmed" ta="center">{a.note}</Text>}
        <Group mt="md" gap="sm">
          <Button variant="default" onClick={() => act({ due_at: new Date(Date.now() + 15 * 60e3).toISOString() })}>15 dk ertele</Button>
          <Button color="lime" leftSection={<IconPhone size={18} />} onClick={() => { maskedCall({ contactId: a.contact_id ?? undefined, phone: a.phone, name: a.name }); act({ status: 'done' }); }}>Şimdi ara</Button>
        </Group>
        <Button variant="subtle" color="gray" size="xs" onClick={() => act({ status: 'done' })}>Arandı, kapat</Button>
      </Stack>
    </Modal>
  );
}

import { ActionIcon, Badge, Button, Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCalendarEvent, IconCheck, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { appointments, dueDate, useAppointments } from '../appointments';
import { AppointmentDialog } from '../components/AppointmentDialog';
import { Fab } from '../components/Fab';
import { maskedCall, toastError } from '../components/maskedCall';
import { Empty, Row } from '../components/Row';
import type { Appointment } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');
const DAY = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
function dayLabel(d: Date) {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date())) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${DAY[d.getDay()]}`;
}

export function Appointments() {
  const open = useAppointments();
  const [view, setView] = useState<'open' | 'all'>('open');
  const [past, setPast] = useState<Appointment[] | null>(null);
  const [dialog, { open: openDialog, close }] = useDisclosure(false);

  useEffect(() => { appointments.reload(); }, []);
  useEffect(() => {
    if (view === 'all') api<Appointment[]>('/api/appointments?status=all').then(setPast).catch(toastError);
  }, [view, open]);

  const list = view === 'all' ? (past ?? []) : open;
  const groups = new Map<string, Appointment[]>();
  for (const a of list) {
    const k = dayLabel(dueDate(a));
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const set = (a: Appointment, status: Appointment['status']) => appointments.update(a.id, { status }).catch(toastError);

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text fz={26} fw={600}>Randevular</Text>
        <SegmentedControl value={view} onChange={(v) => setView(v as 'open' | 'all')} radius="xl" size="xs"
          data={[{ value: 'open', label: 'Bekleyen' }, { value: 'all', label: 'Tümü' }]} />
      </Group>

      {!list.length && (
        <Empty icon={IconCalendarEvent} title={view === 'open' ? 'Bekleyen randevu yok.' : 'Henüz randevu yok.'}>
          <Button variant="light" onClick={openDialog}>Randevu oluştur</Button>
        </Empty>
      )}

      {[...groups].map(([day, items]) => (
        <Stack key={day} gap="xs">
          <Text size="sm" fw={600} c="dimmed">{day}</Text>
          {items.map((a, i) => {
            const d = dueDate(a);
            const late = a.status === 'open' && +d < Date.now();
            return (
              <Row
                key={a.id} index={i} name={a.name} title={a.name} tone={late ? 'red.5' : undefined}
                subtitle={[a.phone, a.note].filter(Boolean).join(' · ')}
                callLabel={`${a.name} kişisini ara`} onCall={() => maskedCall({ contactId: a.contact_id ?? undefined, phone: a.phone, name: a.name })}
                meta={<>
                  <Text fw={600} c={late ? 'red.4' : 'orange.4'}>{pad(d.getHours())}:{pad(d.getMinutes())}</Text>
                  {a.status === 'open' ? (
                    <Group gap={4}>
                      <Tooltip label="Arandı"><ActionIcon size="sm" variant="subtle" color="lime" onClick={() => set(a, 'done')} aria-label="Arandı"><IconCheck size={16} /></ActionIcon></Tooltip>
                      <Tooltip label="İptal"><ActionIcon size="sm" variant="subtle" color="gray" onClick={() => set(a, 'cancelled')} aria-label="İptal"><IconX size={16} /></ActionIcon></Tooltip>
                    </Group>
                  ) : <Badge size="sm" variant="light" color={a.status === 'done' ? 'lime' : 'gray'}>{a.status === 'done' ? 'Arandı' : 'İptal'}</Badge>}
                </>}
              />
            );
          })}
        </Stack>
      ))}

      <Fab label="Yeni randevu" onClick={openDialog} />
      <AppointmentDialog target={null} opened={dialog} onClose={close} />
    </Stack>
  );
}

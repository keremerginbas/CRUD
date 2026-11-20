import { Anchor, Avatar, Badge, Button, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Timeline, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowLeft, IconCalendarEvent, IconCalendarPlus, IconMessage, IconPhone, IconPhoneIncoming, IconPhoneOutgoing, IconPhoneX,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { AppointmentDialog } from '../components/AppointmentDialog';
import { SmsDialog } from '../components/SmsDialog';
import { maskedCall } from '../components/maskedCall';
import { daysAgo, formatDate, formatDuration } from '../format';
import { outcomeOf } from '../outcomes';
import type { Call, ContactCard as Card } from '../types';
import { useLoad } from '../useLoad';
import { STATUS_LABELS } from './Calls';

const APPT_STATUS = { open: 'Açık', done: 'Yapıldı', cancelled: 'İptal' } as const;

type Item = { at: string; key: string; icon: ReactNode; color: string; title: ReactNode; body?: ReactNode };

const callItem = (c: Call): Item => {
  const missed = c.status === 'missed' || c.status === 'failed';
  const outcome = outcomeOf(c.outcome);
  return {
    at: c.started_at, key: `c${c.id}`,
    icon: missed ? <IconPhoneX size={14} /> : c.direction === 'inbound' ? <IconPhoneIncoming size={14} /> : <IconPhoneOutgoing size={14} />,
    color: missed ? 'red' : c.direction === 'inbound' ? 'teal' : 'xre',
    title: (
      <Group gap={6}>
        <Anchor href={`#/arama/${c.id}`} size="sm" fw={600}>
          {c.direction === 'inbound' ? 'Gelen arama' : 'Giden arama'}
        </Anchor>
        <Text size="sm" c="dimmed">{missed ? STATUS_LABELS[c.status] : formatDuration(c.duration_sec)}{c.user_name ? ` · ${c.user_name}` : ''}</Text>
        {outcome && <Badge size="sm" variant="light" color={outcome.color}>{outcome.label}</Badge>}
        {c.recording_ref && <Badge size="sm" variant="outline" color="gray">Kayıt</Badge>}
      </Group>
    ),
    body: c.outcome_note ? <Text size="sm">{c.outcome_note}</Text> : undefined,
  };
};

export function ContactCard({ id }: { id: string }) {
  const { data: c, error } = useLoad(() => api<Card>(`/api/contacts/${encodeURIComponent(id)}`), [id]);
  const [smsOpen, sms] = useDisclosure(false);
  const [apptOpen, appt] = useDisclosure(false);

  if (error) return <Text c="red.5" ta="center" py="xl">{error}</Text>;
  if (!c) return <Skeleton h={360} radius="lg" />;

  const target = { contactId: c.id, name: c.name, phone: c.phone };
  const answered = c.calls.filter((x) => x.status === 'completed' || x.status === 'answered');
  const lastOutcome = c.calls.map((x) => outcomeOf(x.outcome)).find(Boolean);
  const stats: [string, ReactNode][] = [
    ['Arama', c.calls.length],
    ['Görüşülen', answered.length],
    ['Toplam süre', formatDuration(answered.reduce((s, x) => s + x.duration_sec, 0))],
    ['Son durum', lastOutcome ? <Badge variant="light" color={lastOutcome.color}>{lastOutcome.label}</Badge> : '—'],
  ];

  const items: Item[] = [
    ...c.calls.map(callItem),
    ...c.sms.map((s) => ({
      at: s.created_at, key: `s${s.id}`, icon: <IconMessage size={14} />, color: s.status === 'sent' ? 'grape' : 'red',
      title: <Text size="sm" fw={600}>SMS {s.status === 'sent' ? 'gönderildi' : 'gönderilemedi'}<Text span size="sm" c="dimmed" fw={400}>{s.user_name ? ` · ${s.user_name}` : ''}</Text></Text>,
      body: <Text size="sm" c="dimmed" lineClamp={3}>{s.message}</Text>,
    })),
    ...c.appointments.map((a) => ({
      at: a.due_at, key: `a${a.id}`, icon: <IconCalendarEvent size={14} />, color: 'yellow',
      title: <Group gap={6}><Text size="sm" fw={600}>Randevu</Text><Badge size="sm" variant="light" color={a.status === 'open' ? 'yellow' : 'gray'}>{APPT_STATUS[a.status]}</Badge><Text size="sm" c="dimmed">{a.user_name ?? ''}</Text></Group>,
      body: a.note ? <Text size="sm">{a.note}</Text> : undefined,
    })),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));

  return (
    <Stack gap="lg">
      <Anchor href="#/kisiler" c="dimmed" size="sm"><Group gap={4}><IconArrowLeft size={16} />Kişiler</Group></Anchor>
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" align="flex-start">
          <Avatar name={c.name} color="initials" radius="xl" size={56} />
          <div>
            <Title order={2} tt="uppercase">{c.name}</Title>
            <Group gap="xs" mt={4}>
              <Text c="dimmed">{c.phone}</Text>
              <Badge variant="light" color={c.type === 'SATICI' ? 'grape' : 'cyan'}>{c.type === 'SATICI' ? 'Satıcı' : 'Alıcı'}</Badge>
              {c.owner_name && <Badge variant="outline" color="gray" style={{ textTransform: 'none' }}>Sorumlu: {c.owner_name}</Badge>}
            </Group>
            {c.note && <Text size="sm" mt={6}>{c.note}</Text>}
          </div>
        </Group>
        <Group gap="xs">
          <Button variant="light" color="gray" leftSection={<IconMessage size={18} />} onClick={sms.open}>SMS</Button>
          <Button variant="light" leftSection={<IconCalendarPlus size={18} />} onClick={appt.open}>Randevu</Button>
          <Button leftSection={<IconPhone size={18} />} onClick={() => maskedCall(target)}>Ara</Button>
        </Group>
      </Group>
      <SmsDialog opened={smsOpen} onClose={sms.close} target={target} />
      <AppointmentDialog opened={apptOpen} onClose={appt.close} target={target} />

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {stats.map(([k, v]) => (
          <Paper key={k} p="md" radius="lg" className="card">
            <Text size="xs" c="dimmed">{k}</Text>
            <Text fw={700} size="xl" component="div">{v}</Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Paper p="lg" radius="lg" className="card">
        <Text fw={600} mb="md">Geçmiş</Text>
        {items.length ? (
          <Timeline bulletSize={26} lineWidth={2}>
            {items.map((it) => (
              <Timeline.Item key={it.key} bullet={it.icon} color={it.color} title={it.title}>
                {it.body}
                <Text size="xs" c="dimmed" mt={2}>{formatDate(it.at)} · {daysAgo(it.at)}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        ) : <Text c="dimmed" size="sm">Bu müşteriyle henüz arama, SMS ya da randevu yok.</Text>}
      </Paper>
    </Stack>
  );
}

import { Anchor, Badge, Button, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconPhone, IconPlayerPlay } from '@tabler/icons-react';
import { useState } from 'react';
import { api, fetchRecording } from '../api';
import { maskedCall, toastError } from '../components/maskedCall';
import { daysAgo, formatDate, formatDuration } from '../format';
import type { Call } from '../types';
import { useLoad } from '../useLoad';
import { STATUS_LABELS, callColor } from './Calls';

export function CallDetail({ id }: { id: string }) {
  const { data: c, error } = useLoad(() => api<Call>(`/api/calls/${encodeURIComponent(id)}`), [id]);
  const [audio, setAudio] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);

  if (error) return <Text c="red.5" ta="center" py="xl">{error}</Text>;
  if (!c) return <Skeleton h={320} radius="lg" />;

  const name = c.contact_name ?? c.customer_phone;
  const rows: [string, string][] = [
    ['Müşteri', c.contact_name ? `${c.contact_name} (${c.contact_type === 'SATICI' ? 'Satıcı' : 'Alıcı'})` : 'Kayıtlı değil'],
    ['Telefon', c.customer_phone],
    [c.direction === 'inbound' ? 'Aranan numara' : 'Müşterinin gördüğü numara', c.dialed_label ? `${c.dialed_label} · ${c.dialed_number}` : (c.dialed_number ?? '—')],
    ['Danışman', c.user_name ?? '—'],
    ['Tarih', `${formatDate(c.started_at)} (${daysAgo(c.started_at).toLocaleLowerCase('tr-TR')})`],
    ['Süre', formatDuration(c.duration_sec)],
  ];

  const play = async () => {
    setLoadingAudio(true);
    try { setAudio(await fetchRecording(c.id)); } catch (e) { toastError(e); } finally { setLoadingAudio(false); }
  };

  return (
    <Stack gap="lg">
      <Anchor href="#/aramalar" c="dimmed" size="sm"><Group gap={4}><IconArrowLeft size={16} />Aramalar</Group></Anchor>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2} c={callColor(c)} tt="uppercase">{name}</Title>
          <Group gap="xs" mt={6}>
            <Badge variant="light" color={callColor(c).split('.')[0]}>{c.direction === 'inbound' ? 'Gelen' : 'Giden'}</Badge>
            <Badge variant="outline" color="gray">{STATUS_LABELS[c.status]}</Badge>
          </Group>
        </div>
        <Button leftSection={<IconPhone size={18} />} onClick={() => maskedCall({ contactId: c.contact_id ?? undefined, phone: c.customer_phone, name })}>
          Geri ara
        </Button>
      </Group>

      <Paper p="lg" radius="lg" bg="dark.6">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          {rows.map(([k, v]) => (
            <div key={k}>
              <Text size="xs" c="dimmed">{k}</Text>
              <Text>{v}</Text>
            </div>
          ))}
        </SimpleGrid>
      </Paper>

      {c.recording_ref && (
        <Paper p="lg" radius="lg" bg="dark.6">
          <Text fw={500} mb="sm">Ses kaydı</Text>
          {audio
            ? <audio controls autoPlay src={audio} style={{ width: '100%' }} />
            : <Button variant="light" leftSection={<IconPlayerPlay size={18} />} loading={loadingAudio} onClick={play}>Kaydı dinle</Button>}
        </Paper>
      )}
    </Stack>
  );
}

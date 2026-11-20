import { Anchor, Badge, Button, Group, Paper, SimpleGrid, Skeleton, Stack, Table, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useEffect } from 'react';
import { api } from '../api';
import { formatDate } from '../format';
import type { Call } from '../types';
import { useLoad } from '../useLoad';

type Status = {
  version: string | null; startedAt: string | null;
  trunks: { name: string; state: string; channels: number; isDefault: boolean; isAgent: boolean }[];
  browsersOnline: { id: number; name: string }[];
  channels: { id: string; name: string; state: string; caller: string; connected: string; exten: string; createdAt: string }[];
  today: { total: number; answered: number; missed: number; lastAt: string | null };
  recentFailed: Call[];
};

const STATE = { online: ['Bağlı', 'lime'], offline: ['Bağlantı yok', 'red'], unknown: ['Bilinmiyor', 'yellow'] } as Record<string, [string, string]>;
const since = (iso: string) => {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return sec < 3600 ? `${Math.floor(sec / 60)} dk ${sec % 60} sn` : `${Math.floor(sec / 3600)} sa ${Math.floor((sec % 3600) / 60)} dk`;
};

// Yönetici için santralin anlık durumu (pbx/doctor.sh'nin panel hali); 15 saniyede bir yenilenir
export function PbxStatus() {
  const { data, error, reload, loading } = useLoad(() => api<Status>('/api/pbx/status'), []);
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);

  if (error) return <Paper p="lg" radius="lg" className="card"><Text c="red.4" fw={600}>✗ {error}</Text></Paper>;
  if (!data) return <Skeleton h={320} radius="lg" />;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Asterisk {data.version}{data.startedAt ? ` · kesintisiz çalışma: ${since(data.startedAt)}` : ''}
        </Text>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} loading={loading} onClick={reload}>Yenile</Button>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {[['Süren görüşme', data.channels.length], ['Açık panel', data.browsersOnline.length],
          ['Bugün arama', data.today.total], ['Bugün cevapsız', data.today.missed]].map(([k, v]) => (
          <Paper key={k} p="md" radius="lg" className="card"><Text size="xs" c="dimmed">{k}</Text><Text fw={700} size="xl">{v}</Text></Paper>
        ))}
      </SimpleGrid>

      <Paper p="lg" radius="lg" className="card">
        <Text fw={600} mb="sm">Operatör bağlantıları</Text>
        <Stack gap="xs">
          {data.trunks.length ? data.trunks.map((t) => {
            const [label, color] = STATE[t.state] ?? [t.state, 'gray'];
            return (
              <Group key={t.name} justify="space-between">
                <Group gap="xs">
                  <Text fw={600}>{t.name}</Text>
                  {t.isDefault && <Badge size="sm" variant="light">Varsayılan</Badge>}
                  {t.isAgent && !t.isDefault && <Badge size="sm" variant="light" color="gray">Danışman cebi</Badge>}
                </Group>
                <Group gap="xs">
                  <Text size="sm" c="dimmed">{t.channels} görüşme</Text>
                  <Badge color={color} variant="light">{label}</Badge>
                </Group>
              </Group>
            );
          }) : <Text c="red.4">Hiç operatör bağlantısı yok: santralde pbx/trunk.sh çalıştırın</Text>}
        </Stack>
      </Paper>

      <Paper p="lg" radius="lg" className="card">
        <Text fw={600} mb="sm">Süren görüşmeler</Text>
        {data.channels.length ? (
          <Table.ScrollContainer minWidth={520}>
            <Table verticalSpacing="xs">
              <Table.Thead><Table.Tr><Table.Th>Kanal</Table.Th><Table.Th>Arayan</Table.Th><Table.Th>Aranan</Table.Th><Table.Th>Durum</Table.Th><Table.Th>Süre</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data.channels.map((c) => (
                  <Table.Tr key={c.id}>
                    <Table.Td><Text size="xs" ff="monospace">{c.name}</Text></Table.Td>
                    <Table.Td>{c.caller || '—'}</Table.Td><Table.Td>{c.connected || c.exten || '—'}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={c.state === 'Up' ? 'lime' : 'yellow'}>{c.state === 'Up' ? 'Görüşmede' : c.state === 'Ringing' || c.state === 'Ring' ? 'Çalıyor' : c.state}</Badge></Table.Td>
                    <Table.Td>{since(c.createdAt)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : <Text size="sm" c="dimmed">Şu an görüşme yok; kanallar boşta.</Text>}
      </Paper>

      <Paper p="lg" radius="lg" className="card">
        <Text fw={600} mb="sm">Paneli açık olanlar ({data.browsersOnline.length})</Text>
        {data.browsersOnline.length
          ? <Group gap="xs">{data.browsersOnline.map((u) => <Badge key={u.id} variant="light" color="lime" style={{ textTransform: 'none' }}>{u.name}</Badge>)}</Group>
          : <Text size="sm" c="dimmed">Şu an kimsenin paneli "Hazır" değil; gelen aramalar cebe ya da asistan hattına gider.</Text>}
      </Paper>

      <Paper p="lg" radius="lg" className="card">
        <Text fw={600} mb="sm">Son 24 saatte cevapsız / başarısız</Text>
        {data.recentFailed.length ? (
          <Stack gap={6}>
            {data.recentFailed.map((c) => (
              <Group key={c.id} justify="space-between" wrap="nowrap">
                <Anchor href={`#/arama/${c.id}`} size="sm">{c.contact_name ?? c.customer_phone}</Anchor>
                <Text size="sm" c="dimmed" truncate>{c.direction === 'inbound' ? 'Gelen' : 'Giden'} · {c.user_name ?? 'atanmamış'} · {formatDate(c.started_at)}</Text>
              </Group>
            ))}
          </Stack>
        ) : <Text size="sm" c="dimmed">Yok.</Text>}
      </Paper>
    </Stack>
  );
}

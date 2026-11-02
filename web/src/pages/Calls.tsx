import { Badge, Button, Paper, SegmentedControl, SimpleGrid, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { api } from '../api';
import { Fab } from '../components/Fab';
import { maskedCall } from '../components/maskedCall';
import { Row } from '../components/Row';
import { daysAgo, formatDate, formatDuration } from '../format';
import { go } from '../router';
import { MANAGERS, useSession } from '../session';
import { CALL_COLORS } from '../theme';
import type { Call } from '../types';
import { useLoad } from '../useLoad';

type Filter = 'all' | 'inbound' | 'outbound' | 'missed';
const FILTERS: [Filter, string][] = [['all', 'Tüm aramalar'], ['inbound', 'Gelen'], ['outbound', 'Giden'], ['missed', 'Cevapsız']];
const matches = (c: Call, f: Filter) => f === 'all' || (f === 'missed' ? c.status === 'missed' : c.direction === f);
const isMissed = (c: Call) => c.status === 'missed' || c.status === 'failed';
export const callColor = (c: Call) => (isMissed(c) ? CALL_COLORS.missed : CALL_COLORS[c.direction]);
export const STATUS_LABELS: Record<Call['status'], string> = {
  initiated: 'Başlatıldı', ringing: 'Çalıyor', answered: 'Görüşmede', completed: 'Tamamlandı', missed: 'Cevapsız', failed: 'Başarısız',
};

export function Calls() {
  const { me } = useSession();
  const isManager = !!me && MANAGERS.includes(me.role);
  const [filter, setFilter] = useState<Filter>('all');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const { data: calls, error, loading } = useLoad(() => api<Call[]>(`/api/calls${scope === 'all' ? '?scope=all' : ''}`), [scope]);
  const shown = (calls ?? []).filter((c) => matches(c, filter));

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {FILTERS.map(([key, label]) => {
          const on = filter === key;
          const count = (calls ?? []).filter((c) => matches(c, key)).length;
          return (
            <UnstyledButton key={key} onClick={() => setFilter(key)} aria-pressed={on}>
              <Paper p="md" radius="lg" h={104} bg={on ? 'dark.0' : 'dark.5'} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <Text ta="right" fz={32} fw={300} lh={1} c={on ? 'dark.8' : key === 'missed' && count ? 'red.5' : undefined}>{loading && !calls ? '–' : count}</Text>
                <Text size="sm" c={on ? 'dark.8' : 'dimmed'}>{label}</Text>
              </Paper>
            </UnstyledButton>
          );
        })}
      </SimpleGrid>

      {isManager && (
        <SegmentedControl
          value={scope} onChange={(v) => setScope(v as 'mine' | 'all')} radius="xl"
          data={[{ value: 'mine', label: 'Benim aramalarım' }, { value: 'all', label: 'Tüm ofis' }]}
        />
      )}

      <div style={{ borderTop: '1px solid var(--mantine-color-dark-4)' }}>
        {loading && !calls && [1, 2, 3].map((i) => <Skeleton key={i} h={88} my="xs" radius="md" />)}
        {error && <Text c="red.5" py="xl" ta="center">{error}</Text>}
        {calls && !shown.length && (
          <Stack align="center" py={48} gap="sm">
            <Text c="dimmed">{filter === 'all' ? 'Henüz arama yok.' : 'Bu filtrede arama yok.'}</Text>
            {filter === 'all' && <Button variant="light" onClick={() => go('kisiler')}>Kişilerden arama başlat</Button>}
          </Stack>
        )}
        {shown.map((c) => {
          const name = c.contact_name ?? c.customer_phone;
          return (
            <Row
              key={c.id} href={`#/arama/${c.id}`} color={callColor(c)} title={name}
              callColor={c.direction === 'outbound' ? 'indigo.3' : 'lime.4'} callLabel={`${name} kişisini geri ara`}
              onCall={() => maskedCall({ contactId: c.contact_id ?? undefined, phone: c.customer_phone, name })}
              details={[
                scope === 'all' && c.user_name ? c.user_name : (c.dialed_label ?? c.dialed_number ?? '—'),
                c.contact_name ? c.customer_phone : STATUS_LABELS[c.status],
                formatDate(c.started_at),
                [c.direction === 'inbound' ? 'Gelen' : 'Giden', c.duration_sec ? formatDuration(c.duration_sec) : ''].filter(Boolean).join(', '),
                daysAgo(c.started_at),
                c.recording_ref ? <Badge size="sm" variant="dot" color="orange">Ses kaydı</Badge> : '',
              ]}
            />
          );
        })}
      </div>

      <Fab label="Kişiler ve yeni arama" onClick={() => go('kisiler')} />
    </Stack>
  );
}

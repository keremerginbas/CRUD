import { BarChart } from '@mantine/charts';
import { Badge, Button, Group, SegmentedControl, SimpleGrid, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight, IconMicrophone, IconPhone, IconPhoneIncoming, IconPhoneOff, IconPhoneOutgoing, IconPhoneX, type Icon } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { Fab } from '../components/Fab';
import { maskedCall } from '../components/maskedCall';
import { Empty, Row } from '../components/Row';
import { daysAgo, formatDate, formatDuration } from '../format';
import { go } from '../router';
import { MANAGERS, useSession } from '../session';
import { CALL_COLORS } from '../theme';
import type { Call } from '../types';
import { outcomeOf } from '../outcomes';
import { useLoad } from '../useLoad';

type Filter = 'all' | 'inbound' | 'outbound' | 'missed';
const FILTERS: [Filter, string, Icon, string][] = [
  ['all', 'Tüm aramalar', IconPhone, 'var(--mantine-color-dark-0)'], ['inbound', 'Gelen', IconPhoneIncoming, 'var(--mantine-color-lime-4)'],
  ['outbound', 'Giden', IconPhoneOutgoing, 'var(--mantine-color-xre-3)'], ['missed', 'Cevapsız', IconPhoneX, 'var(--mantine-color-red-5)'],
];
const matches = (c: Call, f: Filter) => f === 'all' || (f === 'missed' ? c.status === 'missed' : c.direction === f);
const isMissed = (c: Call) => c.status === 'missed' || c.status === 'failed';
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Son 7 günün gelen / giden / cevapsız sayıları (bugün en sağda)
function lastWeek(calls: Call[]) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const rows = days.map((d, i) => ({ key: dayKey(d), gun: i === 6 ? 'Bugün' : DAYS[d.getDay()], Gelen: 0, Giden: 0, Cevapsız: 0 }));
  for (const c of calls) {
    const row = rows.find((r) => r.key === dayKey(new Date(`${c.started_at.replace(' ', 'T')}Z`)));
    if (row) row[isMissed(c) ? 'Cevapsız' : c.direction === 'inbound' ? 'Gelen' : 'Giden']++;
  }
  return rows;
}
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
  const week = useMemo(() => lastWeek(calls ?? []), [calls]);
  const weekTotal = week.reduce((n, d) => n + d.Gelen + d.Giden + d.Cevapsız, 0);

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {FILTERS.map(([key, label, I, color]) => {
          const count = (calls ?? []).filter((c) => matches(c, key)).length;
          return (
            <UnstyledButton key={key} className="stat" onClick={() => setFilter(key)} aria-pressed={filter === key} style={{ '--stat-color': color }}>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <span className="stat-icon"><I size={18} stroke={1.8} /></span>
                <Text fz={30} fw={600} lh={1} c={key === 'missed' && count ? 'red.4' : undefined}>{loading && !calls ? '–' : count}</Text>
              </Group>
              <Text size="sm" c="dimmed" mt="sm">{label}</Text>
            </UnstyledButton>
          );
        })}
      </SimpleGrid>

      {weekTotal > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Son 7 gün</Text>
            <Text size="sm" c="dimmed">{weekTotal} arama</Text>
          </Group>
          <BarChart
            h={150} data={week} dataKey="gun" type="stacked" withLegend legendProps={{ verticalAlign: 'bottom', height: 28 }}
            gridAxis="none" withYAxis={false} barProps={{ radius: 5, maxBarSize: 34 }} tickLine="none"
            series={[{ name: 'Gelen', color: 'lime.5' }, { name: 'Giden', color: 'xre.4' }, { name: 'Cevapsız', color: 'red.5' }]}
          />
        </div>
      )}

      {isManager && (
        <SegmentedControl
          value={scope} onChange={(v) => setScope(v as 'mine' | 'all')} radius="xl"
          data={[{ value: 'mine', label: 'Benim aramalarım' }, { value: 'all', label: 'Tüm ofis' }]}
        />
      )}

      <Stack gap="xs">
        {loading && !calls && [1, 2, 3, 4].map((i) => <Skeleton key={i} h={70} radius={16} />)}
        {error && <Text c="red.5" py="xl" ta="center">{error}</Text>}
        {calls && !shown.length && (
          <Empty icon={IconPhoneOff} title={filter === 'all' ? 'Henüz arama yok.' : 'Bu filtrede arama yok.'}>
            {filter === 'all' && <Button variant="light" onClick={() => go('kisiler')}>Kişilerden arama başlat</Button>}
          </Empty>
        )}
        {shown.map((c, i) => {
          const name = c.contact_name ?? c.customer_phone;
          const missed = isMissed(c);
          return (
            <Row
              key={c.id} index={i} href={`#/arama/${c.id}`} name={c.contact_name ?? '#'} title={name}
              tone={callColor(c)} tag={missed ? IconPhoneX : c.direction === 'inbound' ? IconArrowDownLeft : IconArrowUpRight}
              callLabel={`${name} kişisini geri ara`}
              onCall={() => maskedCall({ contactId: c.contact_id ?? undefined, phone: c.customer_phone, name })}
              subtitle={[
                missed ? STATUS_LABELS[c.status] : c.direction === 'inbound' ? 'Gelen' : 'Giden',
                c.duration_sec ? formatDuration(c.duration_sec) : null,
                scope === 'all' && c.user_name ? c.user_name : (c.dialed_label ?? c.dialed_number),
                outcomeOf(c.outcome)?.label,
              ].filter(Boolean).join(' · ')}
              meta={<>
                <Text size="sm">{daysAgo(c.started_at)}</Text>
                <Text size="xs" c="dimmed" className="hide-xs">{formatDate(c.started_at)}</Text>
                {c.recording_ref && <Badge size="sm" variant="light" color="xre" leftSection={<IconMicrophone size={11} />}>Kayıt</Badge>}
              </>}
            />
          );
        })}
      </Stack>

      <Fab label="Kişiler ve yeni arama" onClick={() => go('kisiler')} />
    </Stack>
  );
}

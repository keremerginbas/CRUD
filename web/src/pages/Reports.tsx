import { BarChart } from '@mantine/charts';
import { Button, Group, Paper, SegmentedControl, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { IconFileSpreadsheet } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { api, downloadFile, saveBlob } from '../api';
import { toastError } from '../components/maskedCall';
import { formatDuration } from '../format';
import { OUTCOMES } from '../outcomes';
import { useSession } from '../session';
import { useLoad } from '../useLoad';
import { PbxStatus } from './PbxStatus';

type Row = {
  user_id: number | null; name: string; role: string | null; total: number; inbound: number; outbound: number;
  answered: number; missed: number; talk_sec: number; [k: `o_${string}`]: number;
};
type Summary = { from: string; to: string; rows: Row[]; daily: { day: string; total: number; answered: number; missed: number }[] };

// Türkiye saatiyle gün (YYYY-MM-DD)
const trDay = (d: Date) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
function preset(kind: string): [string, string] {
  const now = new Date();
  const today = trDay(now);
  if (kind === 'bugun') return [today, today];
  if (kind === 'hafta') {
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Pazartesi = 0
    return [trDay(new Date(now.getTime() - dow * 86400e3)), today];
  }
  if (kind === 'gecen-ay') {
    const first = new Date(`${today.slice(0, 8)}01T12:00:00Z`);
    const prevLast = new Date(first.getTime() - 86400e3);
    return [`${prevLast.toISOString().slice(0, 8)}01`, prevLast.toISOString().slice(0, 10)];
  }
  return [`${today.slice(0, 8)}01`, today];
}

const pct = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : '—');
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function CallReport() {
  const [range, setRange] = useState(() => preset('ay'));
  const [kind, setKind] = useState('ay');
  const [from, to] = range;
  const { data, error } = useLoad(() => api<Summary>(`/api/reports/summary?from=${from}&to=${to}`), [from, to]);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => (data?.rows ?? []).reduce((t, r) => ({
    total: t.total + r.total, answered: t.answered + r.answered, missed: t.missed + r.missed, talk: t.talk + r.talk_sec,
  }), { total: 0, answered: 0, missed: 0, talk: 0 }), [data]);
  const chart = useMemo(() => (data?.daily ?? []).map((d) => ({
    gun: `${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`, Görüşülen: d.answered, Cevapsız: d.missed, Diğer: d.total - d.answered - d.missed,
  })), [data]);

  const pick = (k: string) => { setKind(k); setRange(preset(k)); };
  const exportCalls = async () => {
    setBusy(true);
    try { await downloadFile(`/api/reports/calls.csv?from=${from}&to=${to}`, `aramalar_${from}_${to}.csv`); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const exportSummary = () => {
    if (!data) return;
    const header = ['Danışman', 'Toplam', 'Gelen', 'Giden', 'Görüşülen', 'Cevapsız', 'Cevapsız oranı', 'Toplam konuşma (dk)', 'Ort. görüşme (sn)', ...OUTCOMES.map((o) => o.label)];
    const lines = data.rows.map((r) => [r.name, r.total, r.inbound, r.outbound, r.answered, r.missed, pct(r.missed, r.total),
      Math.round(r.talk_sec / 60), r.answered ? Math.round(r.talk_sec / r.answered) : 0, ...OUTCOMES.map((o) => r[`o_${o.value}`] ?? 0)]);
    saveBlob(new Blob(['﻿' + [header, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `ozet_${from}_${to}.csv`);
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Group gap="sm" align="flex-end">
          <SegmentedControl value={kind} onChange={pick} radius="xl" data={[
            { value: 'bugun', label: 'Bugün' }, { value: 'hafta', label: 'Bu hafta' }, { value: 'ay', label: 'Bu ay' }, { value: 'gecen-ay', label: 'Geçen ay' },
          ]} />
          <TextInput type="date" label="Başlangıç" value={from} max={to} onChange={(e) => { setKind(''); setRange([e.currentTarget.value || from, to]); }} />
          <TextInput type="date" label="Bitiş" value={to} min={from} onChange={(e) => { setKind(''); setRange([from, e.currentTarget.value || to]); }} />
        </Group>
        <Group gap="xs">
          <Button variant="light" leftSection={<IconFileSpreadsheet size={18} />} onClick={exportSummary} disabled={!data?.rows.length}>Özeti Excel'e aktar</Button>
          <Button leftSection={<IconFileSpreadsheet size={18} />} onClick={exportCalls} loading={busy} disabled={!data?.rows.length}>Aramaları Excel'e aktar</Button>
        </Group>
      </Group>

      {error && <Text c="red.5">{error}</Text>}
      {!data ? <Skeleton h={320} radius="lg" /> : (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            {[['Toplam arama', totals.total], ['Görüşülen', totals.answered], ['Cevapsız', `${totals.missed} (${pct(totals.missed, totals.total)})`],
              ['Toplam konuşma', formatDuration(totals.talk)]].map(([k, v]) => (
              <Paper key={k} p="md" radius="lg" className="card"><Text size="xs" c="dimmed">{k}</Text><Text fw={700} size="xl">{v}</Text></Paper>
            ))}
          </SimpleGrid>

          {chart.length > 1 && (
            <Paper p="lg" radius="lg" className="card">
              <Text fw={600} mb="sm">Günlük aramalar</Text>
              <BarChart h={180} data={chart} dataKey="gun" type="stacked" withLegend legendProps={{ verticalAlign: 'bottom', height: 28 }}
                gridAxis="y" barProps={{ radius: 4, maxBarSize: 28 }} tickLine="none"
                series={[{ name: 'Görüşülen', color: 'lime.5' }, { name: 'Cevapsız', color: 'red.5' }, { name: 'Diğer', color: 'gray.6' }]} />
            </Paper>
          )}

          <Paper p="md" radius="lg" className="card">
            {data.rows.length ? (
              <Table.ScrollContainer minWidth={900}>
                <Table verticalSpacing="sm" highlightOnHover>
                  <Table.Thead><Table.Tr>
                    <Table.Th>Danışman</Table.Th><Table.Th ta="right">Toplam</Table.Th><Table.Th ta="right">Gelen</Table.Th><Table.Th ta="right">Giden</Table.Th>
                    <Table.Th ta="right">Görüşülen</Table.Th><Table.Th ta="right">Cevapsız</Table.Th><Table.Th ta="right">Ort. süre</Table.Th><Table.Th ta="right">Toplam</Table.Th>
                    {OUTCOMES.map((o) => <Table.Th key={o.value} ta="right">{o.label}</Table.Th>)}
                  </Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {data.rows.map((r) => (
                      <Table.Tr key={r.user_id ?? 'none'}>
                        <Table.Td fw={600} className="nowrap">{r.name}</Table.Td>
                        <Table.Td ta="right">{r.total}</Table.Td><Table.Td ta="right">{r.inbound}</Table.Td><Table.Td ta="right">{r.outbound}</Table.Td>
                        <Table.Td ta="right">{r.answered}</Table.Td>
                        <Table.Td ta="right" c={r.total && r.missed / r.total > 0.3 ? 'red.4' : undefined}>{r.missed} <Text span size="xs" c="dimmed">{pct(r.missed, r.total)}</Text></Table.Td>
                        <Table.Td ta="right">{r.answered ? formatDuration(Math.round(r.talk_sec / r.answered)) : '—'}</Table.Td>
                        <Table.Td ta="right">{formatDuration(r.talk_sec)}</Table.Td>
                        {OUTCOMES.map((o) => <Table.Td key={o.value} ta="right">{r[`o_${o.value}`] || '—'}</Table.Td>)}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : <Text c="dimmed" ta="center" py="xl">Bu tarih aralığında arama yok.</Text>}
          </Paper>
        </>
      )}
    </Stack>
  );
}

export function Reports() {
  const { me } = useSession();
  return (
    <Stack gap="lg">
      <Title order={2}>Raporlar</Title>
      <Tabs defaultValue="aramalar" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="aramalar">Danışman raporu</Tabs.Tab>
          {me?.role === 'admin' && <Tabs.Tab value="santral">Santral durumu</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="aramalar" pt="md"><CallReport /></Tabs.Panel>
        {me?.role === 'admin' && <Tabs.Panel value="santral" pt="md"><PbxStatus /></Tabs.Panel>}
      </Tabs>
    </Stack>
  );
}

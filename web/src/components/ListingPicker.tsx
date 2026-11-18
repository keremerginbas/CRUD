import { Badge, Group, Modal, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { SPECIALTY_COLORS, SPECIALTY_LABELS } from '../specialties';
import type { Listing } from '../types';

export const formatPrice = (p: number | null) => (p == null ? '' : `${p.toLocaleString('tr-TR')} ₺`);

// İlan no, başlık, semt ya da danışman adıyla ilan seçer
export function ListingPicker({ opened, onClose, onPick, title = 'İlan seç' }: {
  opened: boolean; onClose: () => void; onPick: (l: Listing) => void; title?: string;
}) {
  const [q, setQ] = useState('');
  const [query] = useDebouncedValue(q.trim(), 200);
  const [list, setList] = useState<Listing[]>([]);
  useEffect(() => {
    if (!opened) return;
    api<Listing[]>(`/api/listings?q=${encodeURIComponent(query)}`).then(setList).catch(() => setList([]));
  }, [opened, query]);
  useEffect(() => { if (opened) setQ(''); }, [opened]);

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered radius="lg" size="lg">
      <Stack gap="sm">
        <TextInput data-autofocus value={q} onChange={(e) => setQ(e.currentTarget.value)} leftSection={<IconSearch size={16} />}
          placeholder="İlan no, başlık, semt ya da danışman" />
        <Stack gap={6} mah={420} style={{ overflowY: 'auto' }}>
          {!list.length && <Text c="dimmed" ta="center" py="lg">İlan bulunamadı</Text>}
          {list.map((l) => (
            <UnstyledButton key={l.id} className="row-card" onClick={() => onPick(l)} disabled={!l.user_id}>
              <div className="row-main">
                <Group gap={6} wrap="nowrap">
                  <Badge size="sm" variant="light" color={SPECIALTY_COLORS[l.category]}>{SPECIALTY_LABELS[l.category]}</Badge>
                  <Text fw={600} truncate>{l.ref} · {l.title}</Text>
                </Group>
                <Text size="sm" c="dimmed" truncate>{[l.district, formatPrice(l.price), l.user_name ?? 'Danışmanı yok'].filter(Boolean).join(' · ')}</Text>
              </div>
            </UnstyledButton>
          ))}
        </Stack>
      </Stack>
    </Modal>
  );
}

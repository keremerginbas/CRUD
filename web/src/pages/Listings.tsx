import { ActionIcon, Anchor, Badge, Button, Group, Modal, NumberInput, SegmentedControl, Select, Skeleton, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconBuildingStore, IconExternalLink, IconPencil, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../api';
import { Fab } from '../components/Fab';
import { formatPrice } from '../components/ListingPicker';
import { toastError, toastOk } from '../components/maskedCall';
import { Empty } from '../components/Row';
import { MANAGERS, useSession } from '../session';
import { SPECIALTY_COLORS, SPECIALTY_LABELS } from '../specialties';
import type { Listing, User } from '../types';
import { useLoad } from '../useLoad';

type Draft = Partial<Listing> & { id?: number };

export function Listings() {
  const { me } = useSession();
  const isManager = !!me && MANAGERS.includes(me.role);
  const [q, setQ] = useState('');
  const [query] = useDebouncedValue(q.trim(), 250);
  const [cat, setCat] = useState('all');
  const list = useLoad(() => api<Listing[]>(`/api/listings?all=1&q=${encodeURIComponent(query)}`), [query]);
  const users = useLoad(() => (isManager ? api<User[]>('/api/users') : Promise.resolve([] as User[])), [isManager]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const shown = (list.data ?? []).filter((l) => cat === 'all' || l.category === cat);
  const canEdit = (l: Listing) => isManager || l.user_id === me?.id;
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = { ...draft, user_id: draft.user_id ?? me?.id };
      await api(draft.id ? `/api/listings/${draft.id}` : '/api/listings', { method: draft.id ? 'PUT' : 'POST', body });
      toastOk(draft.id ? 'İlan güncellendi' : 'İlan eklendi');
      setDraft(null);
      list.reload();
    } catch (e) { toastError(e); } finally { setSaving(false); }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text fz={26} fw={600}>İlanlar</Text>
        <SegmentedControl value={cat} onChange={setCat} radius="xl" size="xs"
          data={[{ value: 'all', label: 'Tümü' }, ...Object.entries(SPECIALTY_LABELS).map(([value, label]) => ({ value, label }))]} />
      </Group>
      <TextInput value={q} onChange={(e) => setQ(e.currentTarget.value)} leftSection={<IconSearch size={16} />} placeholder="İlan no, başlık, semt ya da danışman" />

      <Stack gap="xs">
        {list.loading && !list.data && [1, 2, 3].map((i) => <Skeleton key={i} h={70} radius={16} />)}
        {list.data && !shown.length && (
          <Empty icon={IconBuildingStore} title="İlan yok.">
            <Button variant="light" onClick={() => setDraft({ category: 'konut' })}>İlan ekle</Button>
          </Empty>
        )}
        {shown.map((l) => (
          <div key={l.id} className="row-card" style={{ opacity: l.active ? 1 : 0.55 }}>
            <div className="row-main">
              <Group gap={6} wrap="nowrap">
                <Badge size="sm" variant="light" color={SPECIALTY_COLORS[l.category]}>{SPECIALTY_LABELS[l.category]}</Badge>
                <Text fw={600} truncate>{l.ref} · {l.title}</Text>
                {!l.active && <Badge size="sm" color="gray" variant="outline">Pasif</Badge>}
              </Group>
              <Text size="sm" c="dimmed" truncate>{[l.district, formatPrice(l.price), l.user_name ?? 'Danışmanı yok'].filter(Boolean).join(' · ')}</Text>
            </div>
            <Group gap={4} wrap="nowrap">
              {l.url && <Tooltip label="İlanı aç"><ActionIcon component="a" href={l.url} target="_blank" rel="noreferrer" variant="subtle" color="gray"><IconExternalLink size={18} /></ActionIcon></Tooltip>}
              {canEdit(l) && <Tooltip label="Düzenle"><ActionIcon variant="subtle" color="gray" onClick={() => setDraft(l)} aria-label={`${l.ref} düzenle`}><IconPencil size={18} /></ActionIcon></Tooltip>}
            </Group>
          </div>
        ))}
      </Stack>

      <Fab label="Yeni ilan" onClick={() => setDraft({ category: 'konut' })} />

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'İlanı düzenle' : 'Yeni ilan'} centered radius="lg">
        {draft && (
          <Stack>
            <Group grow>
              <TextInput label="İlan no" required value={draft.ref ?? ''} onChange={(e) => setDraft({ ...draft, ref: e.currentTarget.value })} />
              <Select label="Kategori" required allowDeselect={false} value={draft.category} onChange={(v) => setDraft({ ...draft, category: v as Listing['category'] })}
                data={Object.entries(SPECIALTY_LABELS).map(([value, label]) => ({ value, label }))} />
            </Group>
            <TextInput label="Başlık" required placeholder="Çankaya 3+1 daire" value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })} />
            <Group grow>
              <TextInput label="Semt / ilçe" value={draft.district ?? ''} onChange={(e) => setDraft({ ...draft, district: e.currentTarget.value })} />
              <NumberInput label="Fiyat" thousandSeparator="." decimalSeparator="," suffix=" ₺" min={0} value={draft.price ?? ''}
                onChange={(v) => setDraft({ ...draft, price: v === '' ? null : Number(v) })} />
            </Group>
            <TextInput label="İlan bağlantısı" placeholder="https://" value={draft.url ?? ''} onChange={(e) => setDraft({ ...draft, url: e.currentTarget.value })} />
            {isManager && (
              <Select label="Danışman" searchable value={draft.user_id ? String(draft.user_id) : String(me?.id)}
                data={(users.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
                onChange={(v) => setDraft({ ...draft, user_id: v ? Number(v) : null })} />
            )}
            {draft.id && <Switch label="Yayında" checked={draft.active !== 0} onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked ? 1 : 0 })} />}
            {draft.url && <Anchor href={draft.url} target="_blank" size="sm">İlanı yeni sekmede aç</Anchor>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDraft(null)}>Vazgeç</Button>
              <Button onClick={save} loading={saving}>Kaydet</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

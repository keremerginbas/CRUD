import { ActionIcon, Badge, Button, Group, Modal, Radio, Select, Skeleton, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconAddressBook, IconCalendarPlus, IconMessage, IconPencil, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Fab } from '../components/Fab';
import { maskedCall, toastError, toastOk } from '../components/maskedCall';
import { Empty, Row } from '../components/Row';
import { AppointmentDialog } from '../components/AppointmentDialog';
import { SmsDialog, type SmsTarget } from '../components/SmsDialog';
import { formatDate } from '../format';
import type { Contact, User } from '../types';
import { MANAGERS, useSession } from '../session';
import { useLoad } from '../useLoad';

export function Contacts() {
  const [search, setSearch] = useState('');
  const [query] = useDebouncedValue(search.trim(), 300);
  const { data: contacts, error, loading, reload } = useLoad(() => api<Contact[]>(`/api/contacts?q=${encodeURIComponent(query)}`), [query]);
  const [opened, { open, close }] = useDisclosure(false);
  const [saving, setSaving] = useState(false);
  const [smsTarget, setSmsTarget] = useState<SmsTarget | null>(null);
  const [apptTarget, setApptTarget] = useState<SmsTarget | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const { me } = useSession();
  const isManager = !!me && MANAGERS.includes(me.role);
  const canEdit = (c: Contact) => isManager || c.owner_id === me?.id;
  const users = useLoad(() => (isManager ? api<User[]>('/api/users') : Promise.resolve([] as User[])), [isManager]);
  const userOptions = useMemo(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: u.name })), [users.data]);

  const startEdit = (c: Contact) => { setEditing(c); setOwnerId(c.owner_id ? String(c.owner_id) : null); };
  const saveEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget));
      if (isManager) body.owner_id = ownerId ? Number(ownerId) : null;
      await api(`/api/contacts/${editing.id}`, { method: 'PUT', body });
      toastOk('Kişi güncellendi');
      setEditing(null);
      reload();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };
  const remove = (c: Contact) => modals.openConfirmModal({
    title: 'Kişiyi sil', centered: true,
    children: <Text size="sm"><b>{c.name}</b> ({c.phone}) silinsin mi? Geçmiş aramalar silinmez; bu numara arayınca kayıtsız müşteri sayılır.</Text>,
    labels: { confirm: 'Sil', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: async () => {
      try {
        await api(`/api/contacts/${c.id}`, { method: 'DELETE' });
        toastOk('Kişi silindi');
        setEditing(null);
        reload();
      } catch (err) { toastError(err); }
    },
  });

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/contacts', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
      toastOk('Kişi kaydedildi');
      close();
      reload();
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg">
      <TextInput
        value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="İsim veya telefonla ara"
        leftSection={<IconSearch size={18} />} size="md" aria-label="Kişi ara"
      />

      <Stack gap="xs">
        {loading && !contacts && [1, 2, 3, 4].map((i) => <Skeleton key={i} h={70} radius={16} />)}
        {error && <Text c="red.5" py="xl" ta="center">{error}</Text>}
        {contacts && !contacts.length && (
          <Empty icon={IconAddressBook} title={query ? 'Bu aramayla eşleşen kişi yok.' : 'Henüz kişi yok.'}>
            <Button variant="light" onClick={open}>Yeni kişi ekle</Button>
          </Empty>
        )}
        {contacts?.map((c, i) => (
          <Row
            key={c.id} index={i} name={c.name} title={c.name}
            subtitle={[c.phone, c.owner_name && `Sorumlu: ${c.owner_name}`, c.note].filter(Boolean).join(' · ')}
            callLabel={`${c.name} kişisini ara`}
            onCall={() => maskedCall({ contactId: c.id, phone: c.phone, name: c.name })}
            meta={<>
              <Group gap={2} wrap="nowrap">
                <Tooltip label="SMS"><ActionIcon size="sm" variant="subtle" color="gray" aria-label={`${c.name} SMS`}
                  onClick={() => setSmsTarget({ contactId: c.id, name: c.name, phone: c.phone })}><IconMessage size={16} /></ActionIcon></Tooltip>
                <Tooltip label="Randevu"><ActionIcon size="sm" variant="subtle" color="gray" aria-label={`${c.name} randevu`}
                  onClick={() => setApptTarget({ contactId: c.id, name: c.name, phone: c.phone })}><IconCalendarPlus size={16} /></ActionIcon></Tooltip>
                {canEdit(c) && <Tooltip label="Düzenle / sil"><ActionIcon size="sm" variant="subtle" color="gray" aria-label={`${c.name} düzenle`}
                  onClick={() => startEdit(c)}><IconPencil size={16} /></ActionIcon></Tooltip>}
                <Badge size="sm" variant="light" color={c.type === 'SATICI' ? 'grape' : 'cyan'}>{c.type === 'SATICI' ? 'Satıcı' : 'Alıcı'}</Badge>
              </Group>
              <Text size="xs" c="dimmed" className="hide-xs">{formatDate(c.created_at)}</Text>
            </>}
          />
        ))}
      </Stack>

      <Fab label="Yeni kişi" onClick={open} />
      <SmsDialog opened={!!smsTarget} target={smsTarget} onClose={() => setSmsTarget(null)} />
      <AppointmentDialog opened={!!apptTarget} target={apptTarget} onClose={() => setApptTarget(null)} />

      <Modal opened={!!editing} onClose={() => setEditing(null)} title="Kişiyi düzenle" centered radius="lg">
        {editing && (
          <form onSubmit={saveEdit} key={editing.id}>
            <Stack>
              <TextInput name="name" label="Ad soyad" required defaultValue={editing.name} />
              <TextInput name="phone" label="Telefon" type="tel" required defaultValue={editing.phone} />
              <Radio.Group name="type" label="Tür" defaultValue={editing.type}>
                <Group mt="xs"><Radio value="ALICI" label="Alıcı" /><Radio value="SATICI" label="Satıcı" /></Group>
              </Radio.Group>
              <TextInput name="note" label="Not" defaultValue={editing.note ?? ''} />
              {isManager && (
                <Select label="Sorumlu danışman" description="Bu müşteri aradığında doğrudan bu kişiye gider"
                  data={userOptions} value={ownerId} onChange={setOwnerId} searchable clearable placeholder="Yok" />
              )}
              <Group justify="space-between" mt="sm">
                <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => remove(editing)}>Sil</Button>
                <Group>
                  <Button variant="default" onClick={() => setEditing(null)}>Vazgeç</Button>
                  <Button type="submit" loading={saving}>Kaydet</Button>
                </Group>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>

      <Modal opened={opened} onClose={close} title="Yeni kişi" centered radius="lg">
        <form onSubmit={save}>
          <Stack>
            <TextInput name="name" label="Ad soyad" required data-autofocus />
            <TextInput name="phone" label="Telefon" placeholder="05XX XXX XX XX" type="tel" required />
            <Radio.Group name="type" label="Tür" defaultValue="ALICI">
              <Group mt="xs"><Radio value="ALICI" label="Alıcı" /><Radio value="SATICI" label="Satıcı" /></Group>
            </Radio.Group>
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={close}>Vazgeç</Button>
              <Button type="submit" loading={saving}>Kişiyi kaydet</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

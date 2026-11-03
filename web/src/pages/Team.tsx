import { Badge, Button, Code, CopyButton, Group, Modal, Select, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconKey, IconSearch } from '@tabler/icons-react';
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Fab } from '../components/Fab';
import { toastError, toastOk } from '../components/maskedCall';
import { useSession } from '../session';
import type { PbxNumber, Role, User } from '../types';
import { useLoad } from '../useLoad';

const ROLE_LABELS: Record<Role, string> = { admin: 'Yönetici', broker: 'Broker', asistan: 'Asistan', danisman: 'Danışman' };
const NUMBER_TYPES = { personal: 'Danışman hattı', listing: 'İlan hattı', hunt: 'Karşılama hattı' };

function showPassword(who: string, password: string) {
  modals.open({
    title: 'Geçici şifre',
    centered: true,
    children: (
      <Stack>
        <Text size="sm"><b>{who}</b> için geçici şifre. Bu pencere kapanınca şifre bir daha gösterilmez; kişiye iletin, ilk girişte Ayarlar'dan değiştirsin.</Text>
        <Group justify="space-between">
          <Code fz="xl" p="sm">{password}</Code>
          <CopyButton value={password}>{({ copied, copy }) => <Button variant="light" onClick={copy}>{copied ? 'Kopyalandı' : 'Kopyala'}</Button>}</CopyButton>
        </Group>
      </Stack>
    ),
  });
}

export function Team() {
  const { me } = useSession();
  const isAdmin = me?.role === 'admin';
  const users = useLoad(() => api<User[]>('/api/users'), []);
  const numbers = useLoad(() => api<PbxNumber[]>('/api/numbers'), []);
  const [opened, { open, close }] = useDisclosure(false);
  const [saving, setSaving] = useState(false);
  const [numberSearch, setNumberSearch] = useState('');

  const userOptions = useMemo(() => (users.data ?? []).map((u) => ({ value: String(u.id), label: u.name })), [users.data]);
  const shownNumbers = (numbers.data ?? []).filter((n) => {
    const q = numberSearch.trim().toLocaleLowerCase('tr-TR');
    return !q || `${n.did} ${n.label} ${n.user_name ?? ''}`.toLocaleLowerCase('tr-TR').includes(q.replace(/\s/g, '')) || n.label.toLocaleLowerCase('tr-TR').includes(q);
  });

  const resetPassword = (u: User) => modals.openConfirmModal({
    title: `${u.name} için yeni şifre üretilsin mi?`,
    centered: true,
    children: <Text size="sm" c="dimmed">Kişinin eski şifresi çalışmaz hale gelir.</Text>,
    labels: { confirm: 'Yeni şifre üret', cancel: 'Vazgeç' },
    onConfirm: async () => {
      try {
        const { password } = await api<{ password: string }>(`/api/users/${u.id}/reset-password`, { method: 'POST' });
        showPassword(u.name, password);
      } catch (e) { toastError(e); }
    },
  });

  const addUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api<{ user: User; password: string }>('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
      close();
      users.reload();
      showPassword(res.user.name, res.password);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const rename = async (n: PbxNumber, label: string) => {
    if (!label.trim() || label.trim() === n.label) return;
    try {
      await api(`/api/numbers/${encodeURIComponent(n.did)}`, { method: 'PUT', body: { label: label.trim() } });
      numbers.setData((list) => list?.map((x) => (x.did === n.did ? { ...x, label: label.trim() } : x)) ?? null);
      toastOk('Hat adı kaydedildi');
    } catch (e) { toastError(e); }
  };

  const assign = async (n: PbxNumber, value: string | null) => {
    try {
      await api(`/api/numbers/${encodeURIComponent(n.did)}`, { method: 'PUT', body: { user_id: value ? Number(value) : null } });
      numbers.setData((list) => list?.map((x) => (x.did === n.did ? { ...x, user_id: value ? Number(value) : null } : x)) ?? null);
      toastOk(`${n.did} ${value ? 'atandı' : 'boşa alındı'}`);
    } catch (e) { toastError(e); }
  };

  return (
    <Stack gap="lg">
      <Title order={2}>Ekip ve hatlar</Title>
      <Tabs defaultValue="ekip" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="ekip">Ekip {users.data && <Badge size="sm" variant="light" ml={6}>{users.data.length}</Badge>}</Tabs.Tab>
          <Tabs.Tab value="hatlar">Hatlar {numbers.data && <Badge size="sm" variant="light" ml={6}>{numbers.data.length}</Badge>}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="ekip" pt="md">
          {!users.data ? <Skeleton h={240} radius="lg" /> : (
            <Table.ScrollContainer minWidth={560}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr><Table.Th>Ad</Table.Th><Table.Th>Rol ve departman</Table.Th><Table.Th>Hat</Table.Th><Table.Th /></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {users.data.map((u) => {
                    const line = numbers.data?.find((n) => n.user_id === u.id);
                    return (
                      <Table.Tr key={u.id}>
                        <Table.Td><Text>{u.name}</Text><Text size="xs" c="dimmed">{u.email}</Text></Table.Td>
                        <Table.Td><Badge variant="light" color={u.role === 'admin' ? 'orange' : 'gray'}>{ROLE_LABELS[u.role]}</Badge><Text size="xs" c="dimmed" mt={4}>{u.department ?? ''}</Text></Table.Td>
                        <Table.Td><Text size="sm">{line?.did ?? '—'}</Text><Text size="xs" c="dimmed">{u.extension ? `Dahili ${u.extension}` : ''}</Text></Table.Td>
                        <Table.Td ta="right">{isAdmin && <Button size="xs" variant="subtle" leftSection={<IconKey size={14} />} onClick={() => resetPassword(u)}>Şifre sıfırla</Button>}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="hatlar" pt="md">
          <TextInput mb="md" placeholder="Numara, etiket veya kişi ara" leftSection={<IconSearch size={16} />} value={numberSearch} onChange={(e) => setNumberSearch(e.currentTarget.value)} />
          {!numbers.data ? <Skeleton h={240} radius="lg" /> : (
            <Table.ScrollContainer minWidth={560}>
              <Table verticalSpacing="sm">
                <Table.Thead><Table.Tr><Table.Th>Numara</Table.Th><Table.Th>Tür</Table.Th><Table.Th w={260}>Kimin</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {shownNumbers.map((n) => (
                    <Table.Tr key={n.did}>
                      <Table.Td>
                        <Text>{n.did}</Text>
                        {isAdmin ? (
                          <TextInput
                            key={n.label} defaultValue={n.label} size="xs" variant="unstyled" c="dimmed" aria-label={`${n.did} adı`}
                            onBlur={(e) => rename(n, e.currentTarget.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          />
                        ) : <Text size="xs" c="dimmed">{n.label}</Text>}
                      </Table.Td>
                      <Table.Td><Text size="sm">{NUMBER_TYPES[n.type]}</Text></Table.Td>
                      <Table.Td>
                        {n.type === 'hunt' ? <Text size="sm" c="dimmed">Kuyruk</Text> : (
                          <Select
                            data={userOptions} value={n.user_id ? String(n.user_id) : null} onChange={(v) => assign(n, v)}
                            placeholder="Boşta" clearable searchable disabled={!isAdmin} aria-label={`${n.did} sahibi`} size="sm"
                          />
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Tabs.Panel>
      </Tabs>

      {isAdmin && <Fab label="Yeni kullanıcı" onClick={open} />}

      <Modal opened={opened} onClose={close} title="Yeni kullanıcı" centered radius="lg">
        <form onSubmit={addUser}>
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput name="name" label="Ad soyad" required data-autofocus />
              <TextInput name="email" label="Kullanıcı adı" placeholder="ad.soyad" autoCapitalize="none" required />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput name="phone" label="Cep telefonu" type="tel" required />
              <Select name="role" label="Rol" defaultValue="danisman" allowDeselect={false}
                data={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
            </SimpleGrid>
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={close}>Vazgeç</Button>
              <Button type="submit" loading={saving}>Kullanıcıyı ekle</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

import { ActionIcon, Avatar, Badge, Button, Chip, Code, CopyButton, Group, Input, Modal, Select, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconCheck, IconKey, IconPlus, IconSearch, IconTrash, IconUserMinus } from '@tabler/icons-react';
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Fab } from '../components/Fab';
import { toastError, toastOk } from '../components/maskedCall';
import { useSession } from '../session';
import { SPECIALTY_COLORS, SPECIALTY_LABELS, parseSpecialties } from '../specialties';
import type { OfficeSettings, PbxNumber, Role, User } from '../types';
import { useLoad } from '../useLoad';
import { SmsTemplates } from '../components/SmsTemplates';

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
  const [userSearch, setUserSearch] = useState('');
  const [newRole, setNewRole] = useState<string>('danisman');
  const [newSpecialties, setNewSpecialties] = useState<string[]>([]);
  const office = useLoad(() => api<OfficeSettings>('/api/settings'), []);
  const [savingOffice, setSavingOffice] = useState(false);
  const saveOffice = async (patch: Partial<OfficeSettings>) => {
    setSavingOffice(true);
    try {
      office.setData(await api<OfficeSettings>('/api/settings', { method: 'PUT', body: patch }));
      toastOk('Ofis saatleri kaydedildi');
    } catch (e) { toastError(e); } finally { setSavingOffice(false); }
  };
  const shownUsers = (users.data ?? []).filter((u) => {
    const q = userSearch.trim().toLocaleLowerCase('tr-TR');
    return !q || `${u.name} ${u.email} ${u.department ?? ''}`.toLocaleLowerCase('tr-TR').includes(q);
  }).sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));

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

  const approve = async (u: User) => {
    try {
      await api(`/api/users/${u.id}/approve`, { method: 'POST' });
      users.reload();
      toastOk(`${u.name} onaylandı`);
    } catch (e) { toastError(e); }
  };
  const removeUser = (u: User) => modals.openConfirmModal({
    title: `${u.name} ekipten çıkarılsın mı?`,
    centered: true,
    children: <Text size="sm" c="dimmed">Kişi panele giremez; hatları boşa düşer (aramalar asistana gider). Geçmiş aramalar silinmez.</Text>,
    labels: { confirm: 'Ekipten çıkar', cancel: 'Vazgeç' },
    confirmProps: { color: 'red' },
    onConfirm: async () => {
      try {
        await api(`/api/users/${u.id}`, { method: 'DELETE' });
        users.reload(); numbers.reload();
        toastOk(`${u.name} ekipten çıkarıldı`);
      } catch (e) { toastError(e); }
    },
  });

  const addUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...Object.fromEntries(new FormData(e.currentTarget)), role: newRole, specialties: newSpecialties };
      const res = await api<{ user: User; password: string }>('/api/users', { method: 'POST', body });
      setNewSpecialties([]);
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

  // Hattın operatör bağlantısı (santraldeki trunk adı: netgsm, tt...). Boş = santralin varsayılanı
  const setTrunk = async (n: PbxNumber, input: HTMLInputElement) => {
    const trunk = input.value.trim().toLowerCase();
    if (trunk === (n.trunk ?? '')) return;
    try {
      const saved = await api<PbxNumber>(`/api/numbers/${encodeURIComponent(n.did)}`, { method: 'PUT', body: { trunk } });
      numbers.setData((list) => list?.map((x) => (x.did === n.did ? { ...x, trunk: saved.trunk } : x)) ?? null);
      toastOk(trunk ? `${n.did} → ${trunk} bağlantısı` : `${n.did} varsayılan bağlantıda`);
    } catch (e) {
      input.value = n.trunk ?? '';
      toastError(e);
    }
  };

  // Yeni hat ekleme penceresi
  const [lineOpened, lineModal] = useDisclosure(false);
  const [lineType, setLineType] = useState<string>('personal');
  const [lineOwner, setLineOwner] = useState<string | null>(null);
  const addLine = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...Object.fromEntries(new FormData(e.currentTarget)), type: lineType, user_id: lineOwner ? Number(lineOwner) : null };
      const saved = await api<PbxNumber>('/api/numbers', { method: 'POST', body });
      toastOk(`${saved.did} eklendi`);
      lineModal.close(); setLineOwner(null); setLineType('personal');
      numbers.reload();
    } catch (err) { toastError(err); } finally { setSaving(false); }
  };
  const removeLine = (n: PbxNumber) => modals.openConfirmModal({
    title: 'Hattı listeden çıkar', centered: true,
    children: <Text size="sm"><b>{n.did}</b> ({n.label}) listeden çıkarılsın mı? Geçmiş aramalar silinmez. Santral bu numaraya gelen aramaları artık açmaz.</Text>,
    labels: { confirm: 'Çıkar', cancel: 'Vazgeç' }, confirmProps: { color: 'red' },
    onConfirm: async () => {
      try {
        await api(`/api/numbers/${encodeURIComponent(n.did)}`, { method: 'DELETE' });
        numbers.setData((list) => list?.filter((x) => x.did !== n.did) ?? null);
        toastOk(`${n.did} çıkarıldı`);
      } catch (err) { toastError(err); }
    },
  });

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
          <Tabs.Tab value="ofis">Ofis saatleri</Tabs.Tab>
          <Tabs.Tab value="sms">SMS şablonları</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="ekip" pt="md">
          <TextInput mb="md" placeholder="İsim, kullanıcı adı veya departman ara" leftSection={<IconSearch size={16} />} value={userSearch} onChange={(e) => setUserSearch(e.currentTarget.value)} />
          {!users.data ? <Skeleton h={240} radius="lg" /> : (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              {shownUsers.map((u) => {
                const line = numbers.data?.find((n) => n.user_id === u.id);
                return (
                  <div key={u.id} className="card" style={{ padding: 14 }}>
                    <Group wrap="nowrap" align="flex-start" gap="sm">
                      <Avatar name={u.name} color="initials" radius="xl" size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={600} truncate>{u.name}</Text>
                        <Text size="xs" c="dimmed" truncate>{u.email}{u.department ? ` · ${u.department}` : ''}</Text>
                        <Group gap={6} mt={8}>
                          {u.status === 'pending' && <Badge size="sm" color="yellow">Onay bekliyor</Badge>}
                          <Badge size="sm" variant="light" color={u.role === 'admin' ? 'xre' : u.role === 'asistan' ? 'cyan' : 'gray'}>{ROLE_LABELS[u.role]}</Badge>
                          {parseSpecialties(u.specialties).map((s) => <Badge key={s} size="sm" variant="light" color={SPECIALTY_COLORS[s]}>{SPECIALTY_LABELS[s]}</Badge>)}
                          {line
                            ? <Badge size="sm" variant="outline" color="lime" style={{ textTransform: 'none' }}>{line.did}</Badge>
                            : u.role === 'danisman' && <Badge size="sm" variant="outline" color="yellow" style={{ textTransform: 'none' }}>Hat yok</Badge>}
                        </Group>
                      </div>
                      {isAdmin && (
                        <Group gap={2} wrap="nowrap">
                          {u.status === 'pending' && (
                            <Tooltip label="Başvuruyu onayla">
                              <ActionIcon variant="light" color="lime" onClick={() => approve(u)} aria-label={`${u.name} onayla`}><IconCheck size={18} /></ActionIcon>
                            </Tooltip>
                          )}
                          <Tooltip label="Şifre sıfırla">
                            <ActionIcon variant="subtle" color="gray" onClick={() => resetPassword(u)} aria-label={`${u.name} şifresini sıfırla`}><IconKey size={18} /></ActionIcon>
                          </Tooltip>
                          {u.id !== me?.id && (
                            <Tooltip label="Ekipten çıkar">
                              <ActionIcon variant="subtle" color="red" onClick={() => removeUser(u)} aria-label={`${u.name} ekipten çıkar`}><IconUserMinus size={18} /></ActionIcon>
                            </Tooltip>
                          )}
                        </Group>
                      )}
                    </Group>
                  </div>
                );
              })}
            </SimpleGrid>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="sms" pt="md"><SmsTemplates editable={isAdmin} /></Tabs.Panel>

        <Tabs.Panel value="ofis" pt="md">
          {!office.data ? <Skeleton h={160} radius="lg" /> : (
            <div className="card" style={{ padding: 20 }}>
              <Text fw={600}>Asistanların çalışma saatleri</Text>
              <Text size="sm" c="dimmed" mb="md">
                Bu saatlerde danışman hattını arayan kayıtsız müşteri asistana gider. Saat dışında arama, kayıtlı olsun olmasın,
                hattın danışmanına gider.
              </Text>
              <SimpleGrid cols={{ base: 2, sm: 4 }} maw={520}>
                <TimeInput label="Başlangıç" defaultValue={office.data.office_start} disabled={!isAdmin}
                  onBlur={(e) => e.currentTarget.value !== office.data!.office_start && saveOffice({ office_start: e.currentTarget.value })} />
                <TimeInput label="Bitiş" defaultValue={office.data.office_end} disabled={!isAdmin}
                  onBlur={(e) => e.currentTarget.value !== office.data!.office_end && saveOffice({ office_end: e.currentTarget.value })} />
              </SimpleGrid>
              <Input.Wrapper label="Günler" mt="md">
                <Chip.Group multiple value={office.data.office_days.split(',')} onChange={(v) => v.length && saveOffice({ office_days: v.join(',') })}>
                  <Group gap="xs" mt={6}>
                    {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d, i) => (
                      <Chip key={d} value={String((i + 1) % 7)} disabled={!isAdmin || savingOffice}>{d}</Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </Input.Wrapper>
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="hatlar" pt="md">
          <Group mb="md" wrap="nowrap">
            <TextInput style={{ flex: 1 }} placeholder="Numara, etiket veya kişi ara" leftSection={<IconSearch size={16} />} value={numberSearch} onChange={(e) => setNumberSearch(e.currentTarget.value)} />
            {isAdmin && <Button leftSection={<IconPlus size={16} />} onClick={lineModal.open}>Yeni hat</Button>}
          </Group>
          {!numbers.data ? <Skeleton h={240} radius="lg" /> : (
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm">
                <Table.Thead><Table.Tr><Table.Th>Numara</Table.Th><Table.Th>Tür</Table.Th><Table.Th w={150}>Operatör bağlantısı</Table.Th><Table.Th w={260}>Kimin</Table.Th>{isAdmin && <Table.Th w={44} />}</Table.Tr></Table.Thead>
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
                        {isAdmin ? (
                          <TextInput
                            key={n.trunk ?? ''} defaultValue={n.trunk ?? ''} placeholder="varsayılan" size="xs" aria-label={`${n.did} operatör bağlantısı`}
                            onBlur={(e) => setTrunk(n, e.currentTarget)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          />
                        ) : <Text size="sm" c="dimmed">{n.trunk ?? 'varsayılan'}</Text>}
                      </Table.Td>
                      <Table.Td>
                        {n.type === 'hunt' ? <Text size="sm" c="dimmed">Kuyruk</Text> : (
                          <Select
                            data={userOptions} value={n.user_id ? String(n.user_id) : null} onChange={(v) => assign(n, v)}
                            placeholder="Boşta" clearable searchable disabled={!isAdmin} aria-label={`${n.did} sahibi`} size="sm"
                          />
                        )}
                      </Table.Td>
                      {isAdmin && (
                        <Table.Td>
                          <Tooltip label="Listeden çıkar"><ActionIcon variant="subtle" color="red" aria-label={`${n.did} çıkar`} onClick={() => removeLine(n)}><IconTrash size={16} /></ActionIcon></Tooltip>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Tabs.Panel>
      </Tabs>

      {isAdmin && <Fab label="Yeni kullanıcı" onClick={open} />}

      <Modal opened={lineOpened} onClose={lineModal.close} title="Yeni hat" centered radius="lg">
        <form onSubmit={addLine}>
          <Stack>
            <TextInput name="did" label="Numara" placeholder="0533 743 xx xx · 0850 ... · 444 xx xx" type="tel" required data-autofocus />
            <Select label="Tür" value={lineType} onChange={(v) => setLineType(v ?? 'personal')} allowDeselect={false}
              data={Object.entries(NUMBER_TYPES).map(([value, label]) => ({ value, label }))}
              description={lineType === 'hunt' ? 'Kayıtlı müşteri danışmanına, kayıtsız arayan asistana gider' : undefined} />
            <TextInput name="label" label="Hat adı" placeholder="ör. Kaan İnce hattı" />
            {lineType !== 'hunt' && (
              <Select label="Kimin" data={userOptions} value={lineOwner} onChange={setLineOwner} searchable clearable placeholder="Boşta" />
            )}
            <TextInput name="trunk" label="Operatör bağlantısı" placeholder="boş = varsayılan (ör. n850)" autoCapitalize="none"
              description="Santralde trunk.sh ile tanımlanan bağlantının adı" />
            <Text size="xs" c="dimmed">Danışmanın 0533'ü ise numarayı santrale yönlendirmeyi unutmayın (ör. *21*08503035640#).</Text>
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={lineModal.close}>Vazgeç</Button>
              <Button type="submit" loading={saving}>Hattı ekle</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={opened} onClose={close} title="Yeni kullanıcı" centered radius="lg">
        <form onSubmit={addUser}>
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput name="name" label="Ad soyad" required data-autofocus />
              <TextInput name="email" label="Kullanıcı adı" placeholder="ad.soyad" autoCapitalize="none" required />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput name="phone" label="Cep telefonu" type="tel" required />
              <Select label="Rol" value={newRole} onChange={(v) => setNewRole(v ?? 'danisman')} allowDeselect={false}
                data={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
            </SimpleGrid>
            {newRole === 'danisman' && (
              <Input.Wrapper label="Uzmanlık alanı" required description="Birden fazla seçilebilir">
                <Chip.Group multiple value={newSpecialties} onChange={setNewSpecialties}>
                  <Group gap="xs" mt={6}>{Object.entries(SPECIALTY_LABELS).map(([k, l]) => <Chip key={k} value={k}>{l}</Chip>)}</Group>
                </Chip.Group>
              </Input.Wrapper>
            )}
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={close}>Vazgeç</Button>
              <Button type="submit" loading={saving} disabled={newRole === 'danisman' && !newSpecialties.length}>Kullanıcıyı ekle</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

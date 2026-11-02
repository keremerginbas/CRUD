import { Badge, Button, Checkbox, Collapse, Group, Paper, PasswordInput, SimpleGrid, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { toastError, toastOk } from '../components/maskedCall';
import { useSession } from '../session';
import type { User } from '../types';

const NUMBER_TYPES = { personal: 'Hattım', listing: 'İlan hattı', hunt: 'Karşılama hattı' };
type DayKey = 'work' | 'saturday' | 'sunday';

const initial = (u: User) => ({
  forward_phone: u.forward_phone ?? '',
  voice_announcement: !!u.voice_announcement,
  recording_broker: !!u.recording_broker,
  recording_assistant: !!u.recording_assistant,
  work_start: u.work_start, work_end: u.work_end,
  saturday_enabled: !!u.saturday_enabled, saturday_start: u.saturday_start, saturday_end: u.saturday_end,
  sunday_enabled: !!u.sunday_enabled, sunday_start: u.sunday_start, sunday_end: u.sunday_end,
});

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Paper p="lg" radius="lg" bg="dark.6">
      <Text fw={600}>{title}</Text>
      {description && <Text size="sm" c="dimmed" mb="md">{description}</Text>}
      <Stack gap="md" mt={description ? 0 : 'md'}>{children}</Stack>
    </Paper>
  );
}

export function Settings() {
  const { me, refresh } = useSession();
  const [form, setForm] = useState(() => initial(me!));
  const [saving, setSaving] = useState(false);
  // Hat ataması gibi başka ekranlarda yapılan değişiklikler görünsün
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const hours = (day: DayKey) => (
    <SimpleGrid cols={2}>
      <TimeInput label="Başlangıç" value={form[`${day}_start`]} onChange={(e) => set(`${day}_start`, e.currentTarget.value)} required />
      <TimeInput label="Bitiş" value={form[`${day}_end`]} onChange={(e) => set(`${day}_end`, e.currentTarget.value)} required />
    </SimpleGrid>
  );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/me/santral', { method: 'PUT', body: form });
      await refresh();
      toastOk('Ayarlar kaydedildi');
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    try {
      await api('/api/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(target)) });
      target.reset();
      toastOk('Şifre değiştirildi');
    } catch (err) {
      toastError(err);
    }
  };

  const u = me!;
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{u.name}</Title>
        <Text c="dimmed">{u.department ?? u.title}</Text>
      </div>

      <Paper p="lg" radius="lg" bg="dark.6">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
          <div><Text size="xs" c="dimmed">Telefon</Text><Text>{u.phone || '—'}</Text></div>
          {(u.numbers ?? []).map((n) => (
            <div key={n.did}><Text size="xs" c="dimmed">{NUMBER_TYPES[n.type]}</Text><Text>{n.did}</Text></div>
          ))}
          {u.extension && <div><Text size="xs" c="dimmed">Dahili</Text><Text>{u.extension}</Text></div>}
        </SimpleGrid>
        {!u.numbers?.length && <Badge mt="md" color="yellow" variant="light">Size henüz hat atanmadı</Badge>}
      </Paper>

      <form onSubmit={save}>
        <Stack gap="lg">
          <Section title="Santral ayarları" description="Müşteri hattınızı aradığında telefonunuz bu numarada çalar.">
            <TextInput label="Yönlendirilen telefon" placeholder="05XX XXX XX XX" type="tel" value={form.forward_phone} onChange={(e) => set('forward_phone', e.currentTarget.value)} />
            <Switch label="Sesli yönlendirme" description="Açmadan önce kimin aradığı size söylenir" checked={form.voice_announcement} onChange={(e) => set('voice_announcement', e.currentTarget.checked)} />
          </Section>

          <Section title="Ses kaydımı dinleyebilsin">
            <Group gap="xl">
              <Checkbox label="Broker" checked={form.recording_broker} onChange={(e) => set('recording_broker', e.currentTarget.checked)} />
              <Checkbox label="Asistan" checked={form.recording_assistant} onChange={(e) => set('recording_assistant', e.currentTarget.checked)} />
            </Group>
          </Section>

          <Section title="Mesai saatleri" description="Mesai dışındaki aramalar asistana aktarılır.">
            <Text size="sm" fw={500}>Hafta içi</Text>
            {hours('work')}
            <Switch label="Cumartesi çalışıyorum" checked={form.saturday_enabled} onChange={(e) => set('saturday_enabled', e.currentTarget.checked)} />
            <Collapse expanded={form.saturday_enabled}>{hours('saturday')}</Collapse>
            <Switch label="Pazar çalışıyorum" checked={form.sunday_enabled} onChange={(e) => set('sunday_enabled', e.currentTarget.checked)} />
            <Collapse expanded={form.sunday_enabled}>{hours('sunday')}</Collapse>
          </Section>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setForm(initial(u))}>Değişiklikleri geri al</Button>
            <Button type="submit" loading={saving}>Kaydet</Button>
          </Group>
        </Stack>
      </form>

      <Section title="Şifre">
        <form onSubmit={changePassword}>
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <PasswordInput name="current" label="Mevcut şifre" autoComplete="current-password" required />
              <PasswordInput name="next" label="Yeni şifre" description="En az 8 karakter" autoComplete="new-password" minLength={8} required />
            </SimpleGrid>
            <Group justify="flex-end"><Button type="submit" variant="light">Şifreyi değiştir</Button></Group>
          </Stack>
        </form>
      </Section>
    </Stack>
  );
}

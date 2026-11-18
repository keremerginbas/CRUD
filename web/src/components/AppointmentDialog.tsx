import { Button, Checkbox, Chip, Group, Modal, NumberInput, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useEffect, useState } from 'react';
import { appointments } from '../appointments';
import { toastError, toastOk } from './maskedCall';

export type AppointmentTarget = { contactId?: number | null; name?: string; phone?: string };

const at = (days: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
const QUICK: [string, () => Date][] = [
  ['1 saat sonra', () => new Date(Date.now() + 3600e3)],
  ['Yarın 10:00', () => at(1, 10)], ['Yarın 12:00', () => at(1, 12)], ['Yarın 15:00', () => at(1, 15)],
];
const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

// "Yarın 12'de tekrar ara" gibi geri arama randevusu oluşturur
export function AppointmentDialog({ target, opened, onClose }: { target: AppointmentTarget | null; opened: boolean; onClose: () => void }) {
  const [due, setDue] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [remind, setRemind] = useState<number | string>(60);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [sms, setSms] = useState(false);
  const fixed = !!(target?.contactId || target?.phone);

  useEffect(() => {
    if (!opened) return;
    setDue(toLocal(at(1, 12))); setNote(''); setSms(false); setRemind(60); setName(target?.name ?? ''); setPhone(target?.phone ?? '');
  }, [opened, target]);

  const save = async () => {
    if (!due) return;
    setSaving(true);
    try {
      const a = await appointments.create({
        contactId: target?.contactId ?? undefined, name, phone, note,
        due_at: new Date(due.replace(' ', 'T')).toISOString(), remind_before: Number(remind) || 0, sms,
      }) as Awaited<ReturnType<typeof appointments.create>> & { sms?: { ok: boolean } | null };
      if (sms && !a.sms?.ok) toastError(new Error('Randevu kaydedildi ama müşteriye SMS gönderilemedi'));
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      toastOk(`${a.name} için randevu kaydedildi`);
      onClose();
    } catch (e) { toastError(e); } finally { setSaving(false); }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Geri arama randevusu" centered radius="lg">
      <Stack>
        {fixed
          ? <Text fw={600} tt="uppercase">{target?.name ?? target?.phone}</Text>
          : (
            <Group grow>
              <TextInput label="Ad" value={name} onChange={(e) => setName(e.currentTarget.value)} />
              <TextInput label="Telefon" type="tel" required value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
            </Group>
          )}
        <Chip.Group>
          <Group gap={6}>
            {QUICK.map(([label, fn]) => <Chip key={label} size="xs" checked={false} onClick={() => setDue(toLocal(fn()))}>{label}</Chip>)}
          </Group>
        </Chip.Group>
        <DateTimePicker label="Ne zaman aranacak" value={due} onChange={setDue} valueFormat="DD.MM.YYYY HH:mm" minDate={new Date()} required />
        <NumberInput label="Kaç dakika önce hatırlatılsın" value={remind} onChange={setRemind} min={0} max={1440} step={15} suffix=" dk" />
        <Textarea label="Not" placeholder="Ör. Yarın tekrar ara dedi, Çankaya 3+1 ile ilgileniyor" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2} />
        <Checkbox label="Müşteriye SMS ile bildir (“sizi şu saatte arayacağız”)" checked={sms} onChange={(e) => setSms(e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Vazgeç</Button>
          <Button onClick={save} loading={saving} disabled={!due || (!fixed && !phone)}>Randevuyu kaydet</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

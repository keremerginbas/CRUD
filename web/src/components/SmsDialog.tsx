import { Alert, Button, Group, Modal, Select, Stack, Text, Textarea } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toastError, toastOk } from './maskedCall';

export type SmsTemplate = { id: string; title: string; text: string };
export type SmsTarget = { contactId?: number | null; name?: string; phone: string };

// Türkçe karakterli (UC) SMS: ilk mesaj 70, sonrakiler 67 karakter
const segments = (n: number) => (n <= 70 ? 1 : Math.ceil(n / 67));

export function SmsDialog({ target, opened, onClose }: { target: SmsTarget | null; opened: boolean; onClose: () => void }) {
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setText('');
    api<{ enabled: boolean; templates: SmsTemplate[] }>('/api/sms/templates').then((r) => { setTemplates(r.templates); setEnabled(r.enabled); }).catch(toastError);
  }, [opened]);

  useEffect(() => {
    if (!opened || !text.includes('{')) { setPreview(text); return; }
    const t = setTimeout(() => {
      api<{ text: string }>('/api/sms/preview', { method: 'POST', body: { text, contactId: target?.contactId ?? undefined } }).then((r) => setPreview(r.text)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [text, opened, target]);

  const send = async () => {
    setSending(true);
    try {
      await api('/api/sms', { method: 'POST', body: { contactId: target?.contactId ?? undefined, phone: target?.phone, message: text } });
      toastOk('SMS gönderildi');
      onClose();
    } catch (e) { toastError(e); } finally { setSending(false); }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="SMS gönder" centered radius="lg">
      <Stack>
        <Text fw={600} tt="uppercase">{target?.name ?? target?.phone}</Text>
        {!enabled && (
          <Alert color="yellow" variant="light" icon={<IconInfoCircle size={18} />}>SMS servisi henüz ayarlanmadı; yöneticinize başvurun.</Alert>
        )}
        <Select placeholder="Şablon seçin (isteğe bağlı)" data={templates.map((t) => ({ value: t.id, label: t.title }))} clearable
          onChange={(id) => setText(templates.find((t) => t.id === id)?.text ?? '')} />
        <Textarea label="Mesaj" value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={3} maxLength={600}
          description="{ad}, {danisman}, {hat} alanları otomatik doldurulur" />
        {preview && preview !== text && <Text size="sm" c="dimmed">Gidecek mesaj: {preview}</Text>}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">{preview.length} karakter · {segments(preview.length)} SMS</Text>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>Vazgeç</Button>
            <Button onClick={send} loading={sending} disabled={!text.trim() || !enabled}>Gönder</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

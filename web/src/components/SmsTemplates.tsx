import { ActionIcon, Button, Group, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toastError, toastOk } from './maskedCall';
import type { SmsTemplate } from './SmsDialog';

// Yönetici: SMS şablonlarını düzenler. "randevu" kimlikli şablon randevu bildiriminde kullanılır
export function SmsTemplates({ editable }: { editable: boolean }) {
  const [list, setList] = useState<SmsTemplate[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean; templates: SmsTemplate[] }>('/api/sms/templates').then((r) => { setList(r.templates); setEnabled(r.enabled); }).catch(toastError);
  }, []);
  if (!list) return null;
  const set = (i: number, patch: Partial<SmsTemplate>) => setList(list.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const save = async () => {
    setSaving(true);
    try {
      setList((await api<{ templates: SmsTemplate[] }>('/api/sms/templates', { method: 'PUT', body: { templates: list } })).templates);
      toastOk('Şablonlar kaydedildi');
    } catch (e) { toastError(e); } finally { setSaving(false); }
  };

  return (
    <Stack>
      <Text size="sm" c={enabled ? 'dimmed' : 'yellow.5'}>
        {enabled ? 'SMS servisi bağlı.' : 'SMS servisi ayarlı değil: sunucudaki .env dosyasına SMS_API_URL, SMS_USERNAME ve SMS_PASSWORD girilmeli.'}
        {' '}Metinlerde {'{ad}'}, {'{danisman}'}, {'{hat}'} ve randevu şablonunda {'{tarih}'} kullanılabilir.
      </Text>
      {list.map((t, i) => (
        <div key={t.id} className="card" style={{ padding: 14 }}>
          <Group wrap="nowrap" align="flex-start">
            <Stack gap="xs" style={{ flex: 1 }}>
              <TextInput value={t.title} onChange={(e) => set(i, { title: e.currentTarget.value })} disabled={!editable}
                description={t.id === 'randevu' ? 'Randevu bildiriminde kullanılır' : undefined} />
              <Textarea value={t.text} onChange={(e) => set(i, { text: e.currentTarget.value })} autosize minRows={2} disabled={!editable} />
            </Stack>
            {editable && t.id !== 'randevu' && (
              <ActionIcon variant="subtle" color="red" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Şablonu sil"><IconTrash size={18} /></ActionIcon>
            )}
          </Group>
        </div>
      ))}
      {editable && (
        <Group>
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setList([...list, { id: `t${Date.now()}`, title: 'Yeni şablon', text: '' }])}>Şablon ekle</Button>
          <Button onClick={save} loading={saving}>Kaydet</Button>
        </Group>
      )}
    </Stack>
  );
}

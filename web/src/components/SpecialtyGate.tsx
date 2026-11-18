import { Button, Chip, Group, Modal, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { SPECIALTY_LABELS, type Specialty } from '../specialties';
import { toastError } from './maskedCall';

// Danışman uzmanlık alanını seçmeden paneli kullanamaz (ilk girişte bir kez sorulur)
export function SpecialtyGate() {
  const { me, refresh } = useSession();
  const [value, setValue] = useState<Specialty[]>([]);
  const [saving, setSaving] = useState(false);
  if (!me || me.role !== 'danisman' || me.specialties) return null;

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/me/specialties', { method: 'PUT', body: { specialties: value } });
      await refresh();
    } catch (e) { toastError(e); } finally { setSaving(false); }
  };

  return (
    <Modal opened onClose={() => {}} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} centered radius="lg" title="Uzmanlık alanınız">
      <Stack>
        <Text size="sm" c="dimmed">Hangi alanlarda çalışıyorsunuz? Birden fazla seçebilirsiniz. Müşteri ve ilan yönlendirmelerinde kullanılır.</Text>
        <Chip.Group multiple value={value} onChange={(v) => setValue(v as Specialty[])}>
          <Group justify="center" gap="sm">
            {Object.entries(SPECIALTY_LABELS).map(([k, label]) => <Chip key={k} value={k} size="md">{label}</Chip>)}
          </Group>
        </Chip.Group>
        <Button onClick={save} loading={saving} disabled={!value.length} mt="sm">Kaydet</Button>
      </Stack>
    </Modal>
  );
}

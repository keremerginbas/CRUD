import { Button, Chip, Group, Paper, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { api } from '../api';
import { OUTCOMES } from '../outcomes';
import type { Call } from '../types';
import { toastError, toastOk } from './maskedCall';

// Görüşmenin sonucu: danışman tek tıkla işaretler, istersen kısa not ekler
export function OutcomePicker({ call, onSaved }: { call: Call; onSaved: (c: Call) => void }) {
  const [outcome, setOutcome] = useState<string | null>(call.outcome ?? null);
  const [note, setNote] = useState(call.outcome_note ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = outcome !== (call.outcome ?? null) || note.trim() !== (call.outcome_note ?? '');

  const save = async () => {
    setSaving(true);
    try {
      onSaved(await api<Call>(`/api/calls/${call.id}/outcome`, { method: 'PUT', body: { outcome, note } }));
      toastOk('Arama sonucu kaydedildi');
    } catch (e) { toastError(e); } finally { setSaving(false); }
  };

  return (
    <Paper p="lg" radius="lg" className="card">
      <Text fw={500} mb="sm">Görüşmenin sonucu</Text>
      <Chip.Group value={outcome} onChange={(v) => setOutcome(v === outcome ? null : (v as string))}>
        <Group gap="xs">
          {OUTCOMES.map((o) => <Chip key={o.value} value={o.value} color={o.color} variant="light">{o.label}</Chip>)}
        </Group>
      </Chip.Group>
      <Group mt="md" align="flex-end" wrap="nowrap">
        <TextInput style={{ flex: 1 }} placeholder="Kısa not (ör. 3+1 Çankaya, bütçe 5M)" value={note} maxLength={500}
          onChange={(e) => setNote(e.currentTarget.value)} />
        <Button onClick={save} loading={saving} disabled={!dirty}>Kaydet</Button>
      </Group>
    </Paper>
  );
}

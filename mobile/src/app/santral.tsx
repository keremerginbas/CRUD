import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Checkbox, Field, styles } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import type { User } from '../lib/types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// "8:00" → "08:00"
const padTime = (t: string) => (/^\d:\d\d$/.test(t) ? `0${t}` : t);

type Form = Pick<User, 'forward_phone' | 'work_start' | 'work_end' | 'saturday_start' | 'saturday_end' | 'sunday_start' | 'sunday_end'> & {
  voice_announcement: boolean; recording_broker: boolean; recording_assistant: boolean;
  saturday_enabled: boolean; sunday_enabled: boolean;
};

export default function SantralSettings() {
  const { user, refresh } = useSession();
  const [form, setForm] = useState<Form>(() => ({
    forward_phone: user!.forward_phone ?? '',
    voice_announcement: !!user!.voice_announcement,
    recording_broker: !!user!.recording_broker,
    recording_assistant: !!user!.recording_assistant,
    work_start: user!.work_start, work_end: user!.work_end,
    saturday_enabled: !!user!.saturday_enabled, saturday_start: user!.saturday_start, saturday_end: user!.saturday_end,
    sunday_enabled: !!user!.sunday_enabled, sunday_start: user!.sunday_start, sunday_end: user!.sunday_end,
  }));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const digital = user?.numbers?.find((n) => n.type === 'personal')?.did ?? '—';

  const save = async () => {
    const body = { ...form };
    for (const k of ['work_start', 'work_end', 'saturday_start', 'saturday_end', 'sunday_start', 'sunday_end'] as const) {
      body[k] = padTime(body[k].trim());
      if (!TIME_RE.test(body[k])) return Alert.alert('Saat hatalı', 'Saatleri SS:DD biçiminde girin (ör. 09:00).');
    }
    setSaving(true);
    try {
      await api('/api/me/santral', { method: 'PUT', body });
      await refresh();
      router.back();
    } catch (e) {
      Alert.alert('Kaydedilemedi', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.section}>
          <Field label="dijital telefon" value={digital} editable={false} />
          <Field label="yönlendirilen telefon" value={form.forward_phone ?? ''} onChangeText={set('forward_phone')} keyboardType="phone-pad" />
          <View style={{ alignItems: 'center' }}>
            <Checkbox label="Sesli Yönlendirme" value={form.voice_announcement} onChange={set('voice_announcement')} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.text}>Ses Kaydını Dinlesin</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
            <Checkbox label="Broker" value={form.recording_broker} onChange={set('recording_broker')} />
            <Checkbox label="Asistan" value={form.recording_assistant} onChange={set('recording_assistant')} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.text}>Mesai Saatleri</Text>
          <Hours form={form} set={set} start="work_start" end="work_end" />
          <Checkbox label="Cumartesi Çalışıyor mu?" value={form.saturday_enabled} onChange={set('saturday_enabled')} />
          {form.saturday_enabled && <Hours form={form} set={set} start="saturday_start" end="saturday_end" />}
          <Checkbox label="Pazar Çalışıyor mu?" value={form.sunday_enabled} onChange={set('sunday_enabled')} />
          {form.sunday_enabled && <Hours form={form} set={set} start="sunday_start" end="sunday_end" />}
          <Text style={styles.muted}>Mesai dışında gelen çağrılar karşılama hattına aktarılır ve size cevapsız çağrı bildirimi gelir.</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 24, paddingTop: 24 }}>
          <Button title="İptal" variant="outline" onPress={() => router.back()} />
          <Button title={saving ? 'Kaydediliyor…' : 'Kaydet'} onPress={save} disabled={saving} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type HourKey = 'work_start' | 'work_end' | 'saturday_start' | 'saturday_end' | 'sunday_start' | 'sunday_end';

function Hours({ form, set, start, end }: {
  form: Form; set: (key: HourKey) => (value: string) => void; start: HourKey; end: HourKey;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 16 }}>
      <View style={{ flex: 1 }}><Field label="başlangıç" value={form[start]} onChangeText={set(start)} keyboardType="numbers-and-punctuation" /></View>
      <View style={{ flex: 1 }}><Field label="bitiş" value={form[end]} onChangeText={set(end)} keyboardType="numbers-and-punctuation" /></View>
    </View>
  );
}

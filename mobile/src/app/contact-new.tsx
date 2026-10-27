import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Button, Checkbox, Field, styles } from '../components/ui';
import { api } from '../lib/api';

export default function NewContact() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<'ALICI' | 'SATICI'>('ALICI');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/contacts', { method: 'POST', body: { name, phone, type } });
      router.back();
    } catch (e) {
      Alert.alert('Kaydedilemedi', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 24, gap: 18 }}>
      <Field label="ad soyad" value={name} onChangeText={setName} autoCapitalize="characters" />
      <Field label="telefon" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="05XX XXX XX XX" />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
        <Checkbox label="Alıcı" value={type === 'ALICI'} onChange={() => setType('ALICI')} />
        <Checkbox label="Satıcı" value={type === 'SATICI'} onChange={() => setType('SATICI')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Button title="İptal" variant="outline" onPress={() => router.back()} />
        <Button title="Kaydet" onPress={save} disabled={saving || !name || !phone} />
      </View>
    </ScrollView>
  );
}

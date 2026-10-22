import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field, SectionTitle } from '../components/ui';
import { createApi } from '../api';
import { ensurePermission } from '../notifications';
import { colors } from '../theme';

export default function SettingsScreen({ serverUrl, onSave, health, providers }) {
  const [url, setUrl] = useState(serverUrl);
  const [status, setStatus] = useState(null);

  async function test() {
    setStatus('Bağlanılıyor…');
    try {
      const h = await createApi(url).health();
      setStatus(`✅ Bağlantı başarılı · ${h.demo ? 'demo veriler' : 'gerçek siteler'} · yapay zekâ ${h.ai ? 'açık' : 'kapalı'}`);
      onSave(url.trim());
    } catch (err) {
      setStatus(`❌ ${err.message}`);
    }
  }

  async function notifications() {
    const ok = await ensurePermission();
    setStatus(ok ? '✅ Bildirim izni verildi' : '❌ Bildirim izni verilmedi (telefon ayarlarından açabilirsiniz)');
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <SectionTitle>Sunucu adresi</SectionTitle>
      <Field
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.20:4000"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.hint}>Bilgisayarda "npm start" çalıştırınca ekrana yazılan adresi girin. Telefon ve bilgisayar aynı Wi-Fi ağında olmalı.</Text>
      <Button label="Kaydet ve bağlantıyı test et" onPress={test} />
      <Button label="Bildirim izni ver" variant="ghost" onPress={notifications} style={{ marginTop: 8 }} />
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <SectionTitle>Durum</SectionTitle>
      <View style={styles.card}>
        <Text style={styles.text}>Veri: {health ? (health.demo ? 'Demo (örnek veriler)' : 'Gerçek siteler') : 'bağlı değil'}</Text>
        <Text style={styles.text}>Yapay zekâ: {health?.ai ? 'açık (OpenAI)' : 'kural tabanlı'}</Text>
        <Text style={styles.text}>Siteler: {providers.map((p) => p.name).join(', ') || '—'}</Text>
      </View>
      <Text style={styles.hint}>
        Uygulama açıkken alarmlar dakikada bir kontrol edilir ve bildirim gösterilir. Uygulama kapalıyken de bildirim almak için sunucuda
        NTFY_TOPIC ayarlayıp telefona "ntfy" uygulamasını kurun (README'ye bakın).
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  hint: { color: colors.muted, fontSize: 12, marginVertical: 8, lineHeight: 17 },
  status: { marginTop: 10, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 4 },
  text: { color: colors.text },
});

import { Bell, CircleAlert, CircleCheck, Wifi } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { createApi } from '../api';
import { Button, Card, Field, SectionTitle } from '../components/ui';
import { ensurePermission } from '../notifications';
import { usePalette } from '../theme';

export default function SettingsScreen({ serverUrl, onSave, health, providers }) {
  const palette = usePalette();
  const [url, setUrl] = useState(serverUrl);
  const [status, setStatus] = useState(null); // { ok, text }

  async function test() {
    setStatus({ ok: null, text: 'Bağlanılıyor…' });
    try {
      const h = await createApi(url).health();
      setStatus({ ok: true, text: `Bağlantı başarılı · ${h.demo ? 'demo veriler' : 'gerçek siteler'} · yapay zekâ ${h.ai ? 'açık' : 'kapalı'}` });
      onSave(url.trim());
    } catch (err) {
      setStatus({ ok: false, text: err.message });
    }
  }

  async function notifications() {
    const ok = await ensurePermission();
    setStatus(ok ? { ok: true, text: 'Bildirim izni verildi' } : { ok: false, text: 'Bildirim izni verilmedi (telefon ayarlarından açabilirsiniz)' });
  }

  const rows = [
    ['Veri', health ? (health.demo ? 'Demo (örnek veriler)' : 'Gerçek siteler') : 'bağlı değil'],
    ['Yapay zekâ', health?.ai ? 'Açık (OpenAI)' : 'Kural tabanlı'],
    ['Siteler', providers.map((p) => p.name.replace(' (demo)', '')).join(', ') || '—'],
  ];

  return (
    <ScrollView contentContainerClassName="p-4" keyboardShouldPersistTaps="handled">
      <SectionTitle>Sunucu adresi</SectionTitle>
      <Field value={url} onChangeText={setUrl} placeholder="http://192.168.1.20:4000" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Text className="my-2 text-xs leading-4 text-ink-muted dark:text-night-muted">
        Bilgisayarda "npm run server" çalıştırınca ekrana yazılan adresi girin. Telefon ve bilgisayar aynı Wi-Fi ağında olmalı.
      </Text>
      <Button label="Kaydet ve bağlantıyı test et" icon={Wifi} onPress={test} />
      <Button label="Bildirim izni ver" icon={Bell} variant="soft" onPress={notifications} className="mt-2" />
      {status ? (
        <View className="mt-3 flex-row items-center gap-2">
          {status.ok === true ? <CircleCheck size={16} color={palette.ok} /> : status.ok === false ? <CircleAlert size={16} color={palette.bad} /> : null}
          <Text className="flex-1 text-ink dark:text-white">{status.text}</Text>
        </View>
      ) : null}

      <SectionTitle>Durum</SectionTitle>
      <Card>
        {rows.map(([k, v], i) => (
          <View key={k} className={`flex-row justify-between py-2 ${i ? 'border-t border-surface-line dark:border-night-line' : ''}`}>
            <Text className="text-ink-muted dark:text-night-muted">{k}</Text>
            <Text className="ml-4 flex-1 text-right font-medium text-ink dark:text-white">{v}</Text>
          </View>
        ))}
      </Card>
      <Text className="my-2 text-xs leading-4 text-ink-muted dark:text-night-muted">
        Uygulama açıkken alarmlar dakikada bir kontrol edilir ve bildirim gösterilir. Uygulama kapalıyken de bildirim almak için sunucuda NTFY_TOPIC
        ayarlayıp telefona "ntfy" uygulamasını kurun (README'ye bakın).
      </Text>
    </ScrollView>
  );
}

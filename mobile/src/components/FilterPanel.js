import { ArrowDownWideNarrow, Clock, Coins, Moon, Sun, Sunrise, Sunset, X } from 'lucide-react-native';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { providerColors, usePalette } from '../theme';
import { Button, Chip, Field, Row, SectionTitle } from './ui';

const STATUS = [
  ['all', 'Hepsi'],
  ['available', 'Müsait'],
  ['soldout', 'Dolu'],
];
const SORTS = [
  ['price', 'En ucuz'],
  ['departure', 'Kalkış saati'],
  ['duration', 'En kısa'],
  ['seats', 'En çok koltuk'],
];
const PARTS = [
  ['Gece', Moon, '00:00', '06:00'],
  ['Sabah', Sunrise, '06:00', '12:00'],
  ['Öğle', Sun, '12:00', '17:00'],
  ['Akşam', Sunset, '17:00', '23:59'],
];

const num = (text) => (text.trim() === '' ? null : Number(text.replace(/[^\d]/g, '')) || null);
const str = (value) => (value === null || value === undefined ? '' : String(value));

export function countActive(f) {
  return [f.providers?.length, f.status !== 'all', f.priceMin, f.priceMax, f.departAfter || f.departBefore, f.minSeats, f.maxDurationMin, f.company].filter(Boolean)
    .length;
}

// Alttan açılan filtre sayfası. Filtreler sonuçlara anında uygulanır.
export default function FilterPanel({ visible, onClose, filters, onChange, providers, onReset, resultCount }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const set = (patch) => onChange({ ...filters, ...patch });
  const toggleProvider = (id) => {
    const current = filters.providers ?? [];
    set({ providers: current.includes(id) ? current.filter((p) => p !== id) : [...current, id] });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-surface-bg dark:bg-night" style={{ paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between border-b border-surface-line px-4 py-3 dark:border-night-line">
          <Text className="text-lg font-bold text-ink dark:text-white">Filtreler</Text>
          <Button icon={X} variant="outline" size="sm" onPress={onClose} />
        </View>

        <ScrollView className="flex-1 px-4" keyboardShouldPersistTaps="handled">
          <SectionTitle>Durum</SectionTitle>
          <View className="flex-row flex-wrap">
            {STATUS.map(([v, l]) => (
              <Chip key={v} label={l} active={filters.status === v} onPress={() => set({ status: v })} />
            ))}
          </View>

          <SectionTitle>Siteler</SectionTitle>
          <View className="flex-row flex-wrap">
            <Chip label="Tümü" active={!filters.providers?.length} onPress={() => set({ providers: [] })} />
            {providers.map((p) => (
              <Chip
                key={p.id}
                label={p.name.replace(' (demo)', '')}
                color={providerColors[p.id]}
                active={filters.providers?.includes(p.id)}
                onPress={() => toggleProvider(p.id)}
              />
            ))}
          </View>

          <SectionTitle>Fiyat (₺)</SectionTitle>
          <Row>
            <Field placeholder="En az" keyboardType="number-pad" value={str(filters.priceMin)} onChangeText={(t) => set({ priceMin: num(t) })} />
            <Field placeholder="En fazla" keyboardType="number-pad" value={str(filters.priceMax)} onChangeText={(t) => set({ priceMax: num(t) })} />
          </Row>

          <SectionTitle>Kalkış saati</SectionTitle>
          <View className="flex-row flex-wrap">
            <Chip label="Her saat" icon={Clock} active={!filters.departAfter && !filters.departBefore} onPress={() => set({ departAfter: null, departBefore: null })} />
            {PARTS.map(([l, Icon, a, b]) => (
              <Chip key={l} label={l} icon={Icon} active={filters.departAfter === a && filters.departBefore === b} onPress={() => set({ departAfter: a, departBefore: b })} />
            ))}
          </View>
          <Row>
            <Field placeholder="ss:dd'den sonra" value={str(filters.departAfter)} onChangeText={(t) => set({ departAfter: t || null })} maxLength={5} />
            <Field placeholder="ss:dd'den önce" value={str(filters.departBefore)} onChangeText={(t) => set({ departBefore: t || null })} maxLength={5} />
          </Row>

          <SectionTitle>Diğer</SectionTitle>
          <Row>
            <Field label="En az boş koltuk" keyboardType="number-pad" value={str(filters.minSeats)} onChangeText={(t) => set({ minSeats: num(t) })} />
            <Field
              label="En uzun süre (saat)"
              keyboardType="number-pad"
              value={filters.maxDurationMin ? String(filters.maxDurationMin / 60) : ''}
              onChangeText={(t) => set({ maxDurationMin: num(t) ? num(t) * 60 : null })}
            />
          </Row>
          <Field label="Firma / havayolu" placeholder="ör. Metro, Pegasus" value={filters.company ?? ''} onChangeText={(t) => set({ company: t })} className="mt-2" />

          <SectionTitle>Sıralama</SectionTitle>
          <View className="mb-4 flex-row flex-wrap">
            {SORTS.map(([v, l]) => (
              <Chip key={v} label={l} icon={v === 'price' ? Coins : ArrowDownWideNarrow} active={filters.sort === v} onPress={() => set({ sort: v })} />
            ))}
          </View>
        </ScrollView>

        <View className="flex-row gap-2 border-t border-surface-line px-4 pt-3 dark:border-night-line">
          <Button label="Sıfırla" variant="outline" onPress={onReset} />
          <Button label={`${resultCount} sonucu göster`} onPress={onClose} className="flex-1" />
        </View>
        <Text className="px-4 py-2 text-center text-xs" style={{ color: palette.muted }}>
          Alarm kurarsanız aynı filtrelerle takip edilir.
        </Text>
      </View>
    </Modal>
  );
}

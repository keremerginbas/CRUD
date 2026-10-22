import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, providerColors } from '../theme';
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
  ['Gece', '00:00', '06:00'],
  ['Sabah', '06:00', '12:00'],
  ['Öğle', '12:00', '17:00'],
  ['Akşam', '17:00', '23:59'],
];

const num = (text) => (text.trim() === '' ? null : Number(text.replace(/[^\d]/g, '')) || null);
const str = (value) => (value === null || value === undefined ? '' : String(value));

export function countActive(f) {
  return [
    f.providers?.length,
    f.status !== 'all',
    f.priceMin,
    f.priceMax,
    f.departAfter || f.departBefore,
    f.minSeats,
    f.maxDurationMin,
    f.company,
  ].filter(Boolean).length;
}

export default function FilterPanel({ filters, onChange, providers, onReset }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const toggleProvider = (id) => {
    const current = filters.providers ?? [];
    set({ providers: current.includes(id) ? current.filter((p) => p !== id) : [...current, id] });
  };

  return (
    <ScrollView style={styles.panel} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
      <SectionTitle>Durum</SectionTitle>
      <View style={styles.wrap}>
        {STATUS.map(([v, l]) => (
          <Chip key={v} label={l} active={filters.status === v} onPress={() => set({ status: v })} />
        ))}
      </View>

      <SectionTitle>Siteler</SectionTitle>
      <View style={styles.wrap}>
        <Chip label="Tümü" active={!filters.providers?.length} onPress={() => set({ providers: [] })} />
        {providers.map((p) => (
          <Chip key={p.id} label={p.name.replace(' (demo)', '')} color={providerColors[p.id]} active={filters.providers?.includes(p.id)} onPress={() => toggleProvider(p.id)} />
        ))}
      </View>

      <SectionTitle>Fiyat (₺)</SectionTitle>
      <Row>
        <Field placeholder="En az" keyboardType="number-pad" value={str(filters.priceMin)} onChangeText={(t) => set({ priceMin: num(t) })} />
        <Field placeholder="En fazla" keyboardType="number-pad" value={str(filters.priceMax)} onChangeText={(t) => set({ priceMax: num(t) })} />
      </Row>

      <SectionTitle>Kalkış saati</SectionTitle>
      <View style={styles.wrap}>
        <Chip label="Her saat" active={!filters.departAfter && !filters.departBefore} onPress={() => set({ departAfter: null, departBefore: null })} />
        {PARTS.map(([l, a, b]) => (
          <Chip key={l} label={l} active={filters.departAfter === a && filters.departBefore === b} onPress={() => set({ departAfter: a, departBefore: b })} />
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
      <Field label="Firma / havayolu" placeholder="ör. Metro, Pegasus" value={filters.company ?? ''} onChangeText={(t) => set({ company: t })} style={{ marginTop: 8 }} />

      <SectionTitle>Sıralama</SectionTitle>
      <View style={styles.wrap}>
        {SORTS.map(([v, l]) => (
          <Chip key={v} label={l} active={filters.sort === v} onPress={() => set({ sort: v })} />
        ))}
      </View>
      <Button label="Filtreleri sıfırla" variant="ghost" onPress={onReset} style={{ marginTop: 8, marginBottom: 12 }} />
      <Text style={styles.hint}>Filtreler sonuçlara anında uygulanır; alarm kurarsanız aynı filtrelerle takip edilir.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { maxHeight: 420, backgroundColor: colors.bg, borderRadius: 12, paddingHorizontal: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  hint: { fontSize: 12, color: colors.muted, marginBottom: 12 },
});

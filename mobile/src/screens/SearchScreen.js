import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import FilterPanel, { countActive } from '../components/FilterPanel';
import TripCard, { formatPrice } from '../components/TripCard';
import { Button, Chip, Field, Row } from '../components/ui';
import { addDays, label, today } from '../dates';
import { applyFilters, DEFAULT_FILTERS } from '../filters';
import { load, save } from '../storage';
import { colors } from '../theme';

const INTERVALS = [2, 5, 10, 30];
const NOTIFY = [
  ['freed', 'Boşalınca'],
  ['seats_up', 'Koltuk açılınca'],
  ['price_drop', 'Fiyat düşünce'],
  ['new', 'Yeni sefer'],
  ['soldout', 'Dolunca'],
];

export default function SearchScreen({ api, providers, aiEnabled, onWatchCreated }) {
  const [query, setQuery] = useState({ mode: 'bus', from: '', to: '', date: addDays(today(), 1) });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [askText, setAskText] = useState('');
  const [result, setResult] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [alarm, setAlarm] = useState(null); // { intervalMin, notifyOn }

  useEffect(() => {
    load('lastSearch', null).then((s) => s && setQuery({ ...s, date: s.date < today() ? addDays(today(), 1) : s.date }));
    load('filters', null).then((f) => f && setFilters({ ...DEFAULT_FILTERS, ...f }));
  }, []);
  useEffect(() => {
    save('filters', filters);
  }, [filters]);

  const trips = useMemo(() => applyFilters(result?.trips ?? [], filters), [result, filters]);
  const stats = useMemo(() => {
    const all = (result?.trips ?? []).filter((t) => !filters.providers?.length || filters.providers.includes(t.provider));
    const open = trips.filter((t) => !t.soldOut && t.price !== null);
    return {
      total: all.length,
      soldOut: all.filter((t) => t.soldOut).length,
      cheapest: open.reduce((min, t) => (!min || t.price < min.price ? t : min), null),
    };
  }, [result, trips, filters.providers]);
  const modeProviders = providers.filter((p) => p.modes.includes(query.mode));

  async function runSearch(q = query) {
    if (!q.from.trim() || !q.to.trim()) return setError('Nereden ve nereye alanlarını doldurun.');
    setLoading(true);
    setError(null);
    setAdvice(null);
    try {
      const data = await api.search({ mode: q.mode, from: q.from.trim(), to: q.to.trim(), date: q.date });
      setResult(data);
      save('lastSearch', q);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function ask() {
    if (!askText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.ask(askText.trim());
      const q = { mode: data.request.mode, from: data.request.from, to: data.request.to, date: data.request.date };
      setQuery(q);
      setFilters({ ...DEFAULT_FILTERS, ...data.request.filters });
      setResult(data);
      setAdvice(data.advice);
      save('lastSearch', q);
      if (data.request.watch) setAlarm({ intervalMin: 5, notifyOn: ['freed', 'seats_up', 'price_drop'] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createAlarm() {
    try {
      const { sort, ...watchFilters } = filters;
      await api.createWatch({
        ...query,
        providers: filters.providers,
        filters: { ...watchFilters, status: 'all' },
        intervalMin: alarm.intervalMin,
        notifyOn: alarm.notifyOn,
      });
      setAlarm(null);
      Alert.alert('Alarm kuruldu', `${query.from} → ${query.to} ${label(query.date)} her ${alarm.intervalMin} dakikada kontrol edilecek.`);
      onWatchCreated?.();
    } catch (err) {
      Alert.alert('Alarm kurulamadı', err.message);
    }
  }

  const header = (
    <View>
      <View style={styles.assistant}>
        <Text style={styles.assistantTitle}>🤖 Asistan {aiEnabled ? '(yapay zekâ)' : ''}</Text>
        <Field
          placeholder="ör. Yarın akşam 18-23 arası İstanbul'dan Ankara'ya 1000 TL altı otobüs, dolu olan boşalırsa haber ver"
          value={askText}
          onChangeText={setAskText}
          multiline
          onSubmitEditing={ask}
        />
        <Button label="Benim için ara" onPress={ask} disabled={loading} style={{ marginTop: 8 }} />
      </View>

      <Row style={{ marginTop: 14 }}>
        <Chip label="🚌 Otobüs" active={query.mode === 'bus'} onPress={() => setQuery({ ...query, mode: 'bus' })} />
        <Chip label="✈️ Uçak" active={query.mode === 'flight'} onPress={() => setQuery({ ...query, mode: 'flight' })} />
      </Row>
      <Row>
        <Field label="Nereden" placeholder={query.mode === 'bus' ? 'İstanbul' : 'IST'} value={query.from} onChangeText={(from) => setQuery({ ...query, from })} />
        <Pressable onPress={() => setQuery({ ...query, from: query.to, to: query.from })} style={styles.swap} accessibilityLabel="Yer değiştir">
          <Text style={styles.swapText}>⇄</Text>
        </Pressable>
        <Field label="Nereye" placeholder={query.mode === 'bus' ? 'Ankara' : 'ESB'} value={query.to} onChangeText={(to) => setQuery({ ...query, to })} />
      </Row>
      <View style={styles.dateRow}>
        <Pressable onPress={() => query.date > today() && setQuery({ ...query, date: addDays(query.date, -1) })} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.date}>{label(query.date)}</Text>
        <Pressable onPress={() => setQuery({ ...query, date: addDays(query.date, 1) })} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>›</Text>
        </Pressable>
        <Chip label="Bugün" active={query.date === today()} onPress={() => setQuery({ ...query, date: today() })} />
        <Chip label="Yarın" active={query.date === addDays(today(), 1)} onPress={() => setQuery({ ...query, date: addDays(today(), 1) })} />
      </View>
      <Button label={loading ? 'Tüm sitelerde aranıyor…' : 'Tüm sitelerde ara'} onPress={() => runSearch()} disabled={loading} />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator style={{ marginTop: 16 }} color={colors.primary} /> : null}

      {result && !loading ? (
        <>
          {result.errors?.map((e) => (
            <Text key={e.provider} style={styles.warning}>
              {e.provider}: {e.message}
            </Text>
          ))}
          {advice ? (
            <View style={styles.advice}>
              <Text style={styles.adviceTitle}>Asistanın önerisi</Text>
              <Text style={styles.adviceText}>{advice.text}</Text>
            </View>
          ) : null}
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              {trips.length}/{stats.total} bilet · {stats.soldOut} dolu
              {stats.cheapest ? ` · en ucuz ${formatPrice(stats.cheapest.price)}` : ''}
            </Text>
            <Chip label={`Filtreler${countActive(filters) ? ` (${countActive(filters)})` : ''}`} active={showFilters} onPress={() => setShowFilters(!showFilters)} />
          </View>
          {showFilters ? (
            <FilterPanel filters={filters} onChange={setFilters} providers={modeProviders} onReset={() => setFilters(DEFAULT_FILTERS)} />
          ) : null}

          {alarm ? (
            <View style={styles.alarmBox}>
              <Text style={styles.adviceTitle}>Alarm: bu arama + filtreler takip edilsin</Text>
              <Text style={styles.small}>Kontrol sıklığı</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {INTERVALS.map((m) => (
                  <Chip key={m} label={`${m} dk`} active={alarm.intervalMin === m} onPress={() => setAlarm({ ...alarm, intervalMin: m })} />
                ))}
              </Row>
              <Text style={styles.small}>Ne zaman haber vereyim?</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {NOTIFY.map(([v, l]) => (
                  <Chip
                    key={v}
                    label={l}
                    active={alarm.notifyOn.includes(v)}
                    onPress={() => setAlarm({ ...alarm, notifyOn: alarm.notifyOn.includes(v) ? alarm.notifyOn.filter((x) => x !== v) : [...alarm.notifyOn, v] })}
                  />
                ))}
              </Row>
              <Row style={{ marginTop: 6 }}>
                <Button label="Alarmı kaydet" onPress={createAlarm} disabled={!alarm.notifyOn.length} style={{ flex: 1 }} />
                <Button label="Vazgeç" variant="ghost" onPress={() => setAlarm(null)} />
              </Row>
            </View>
          ) : (
            <Button
              label="🔔 Dolu biletler boşalınca haber ver"
              variant="ghost"
              onPress={() => setAlarm({ intervalMin: 5, notifyOn: ['freed', 'seats_up', 'price_drop'] })}
              style={{ marginBottom: 10 }}
            />
          )}
        </>
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={loading ? [] : trips}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => <TripCard trip={item} cheapest={item === stats.cheapest} />}
      ListHeaderComponent={header}
      ListEmptyComponent={result && !loading ? <Text style={styles.empty}>Bu filtrelere uyan bilet yok.</Text> : null}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  assistant: { backgroundColor: colors.primarySoft, borderRadius: 14, padding: 12 },
  assistantTitle: { fontWeight: '700', color: colors.primary, marginBottom: 8 },
  swap: { paddingHorizontal: 6, paddingVertical: 10 },
  swapText: { fontSize: 20, color: colors.primary },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12, flexWrap: 'wrap' },
  dateBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  dateBtnText: { fontSize: 24, color: colors.primary },
  date: { fontSize: 16, fontWeight: '600', color: colors.text, minWidth: 110, textAlign: 'center', marginRight: 8 },
  error: { color: colors.danger, marginTop: 10 },
  warning: { color: colors.warning, backgroundColor: colors.warningSoft, padding: 8, borderRadius: 8, marginTop: 8, fontSize: 12 },
  advice: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: colors.primarySoft },
  adviceTitle: { fontWeight: '700', color: colors.text, marginBottom: 6 },
  adviceText: { color: colors.text, lineHeight: 20 },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  summaryText: { color: colors.muted, flex: 1, fontSize: 13 },
  alarmBox: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginVertical: 10, borderWidth: 1, borderColor: colors.border },
  small: { fontSize: 12, color: colors.muted, marginVertical: 6 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 20 },
});

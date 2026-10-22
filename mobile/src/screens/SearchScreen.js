import { ArrowLeftRight, BellRing, Bus, ChevronLeft, ChevronRight, CircleAlert, Plane, Search, SlidersHorizontal, Sparkles } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import FilterPanel, { countActive } from '../components/FilterPanel';
import PriceChart from '../components/PriceChart';
import TripCard, { formatPrice } from '../components/TripCard';
import { Button, Card, Chip, Field, Row } from '../components/ui';
import { addDays, label, today } from '../dates';
import { applyFilters, DEFAULT_FILTERS } from '../filters';
import { load, save } from '../storage';
import { usePalette } from '../theme';

const INTERVALS = [2, 5, 10, 30];
const NOTIFY = [
  ['freed', 'Boşalınca'],
  ['seats_up', 'Koltuk açılınca'],
  ['price_drop', 'Fiyat düşünce'],
  ['new', 'Yeni sefer'],
  ['soldout', 'Dolunca'],
];

export default function SearchScreen({ api, providers, aiEnabled, onWatchCreated }) {
  const palette = usePalette();
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
  // Grafik saat filtresinden bağımsız tüm günü göstersin
  const chartTrips = useMemo(() => applyFilters(result?.trips ?? [], { ...filters, departAfter: null, departBefore: null }), [result, filters]);
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
  const activeFilters = countActive(filters);

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

  function selectRange(after, before) {
    const same = filters.departAfter === after && filters.departBefore === before;
    setFilters({ ...filters, departAfter: same ? null : after, departBefore: same ? null : before });
  }

  const header = (
    <View>
      <Card className="border-brand-soft bg-brand-soft dark:border-night-line dark:bg-night-card">
        <View className="mb-2 flex-row items-center gap-1.5">
          <Sparkles size={16} color={palette.brand} />
          <Text className="font-bold text-brand dark:text-white">Asistan{aiEnabled ? ' · yapay zekâ' : ''}</Text>
        </View>
        <Field
          placeholder="ör. Yarın akşam 18-23 arası İstanbul'dan Ankara'ya 1000 TL altı otobüs, dolu olan boşalırsa haber ver"
          value={askText}
          onChangeText={setAskText}
          multiline
          inputClassName="min-h-[64px]"
        />
        <Button label="Benim için ara" icon={Sparkles} onPress={ask} disabled={loading} className="mt-2" />
      </Card>

      <View className="mt-4 flex-row rounded-xl bg-surface-line p-1 dark:bg-night-card">
        {[
          ['bus', 'Otobüs', Bus],
          ['flight', 'Uçak', Plane],
        ].map(([mode, text, Icon]) => {
          const active = query.mode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setQuery({ ...query, mode })}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2 ${active ? 'bg-surface dark:bg-night-line' : ''}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Icon size={16} color={active ? palette.brand : palette.muted} />
              <Text className={active ? 'font-semibold text-brand dark:text-white' : 'text-ink-muted dark:text-night-muted'}>{text}</Text>
            </Pressable>
          );
        })}
      </View>

      <Row className="mt-3">
        <Field label="Nereden" placeholder={query.mode === 'bus' ? 'İstanbul' : 'IST'} value={query.from} onChangeText={(from) => setQuery({ ...query, from })} />
        <Button icon={ArrowLeftRight} variant="soft" size="sm" onPress={() => setQuery({ ...query, from: query.to, to: query.from })} className="mb-1" />
        <Field label="Nereye" placeholder={query.mode === 'bus' ? 'Ankara' : 'ESB'} value={query.to} onChangeText={(to) => setQuery({ ...query, to })} />
      </Row>

      <View className="my-3 flex-row flex-wrap items-center">
        <Button icon={ChevronLeft} variant="outline" size="sm" onPress={() => query.date > today() && setQuery({ ...query, date: addDays(query.date, -1) })} />
        <Text className="mx-2 min-w-[96px] text-center text-base font-semibold text-ink dark:text-white">{label(query.date)}</Text>
        <Button icon={ChevronRight} variant="outline" size="sm" onPress={() => setQuery({ ...query, date: addDays(query.date, 1) })} className="mr-2" />
        <View className="flex-row pt-1.5">
          <Chip label="Bugün" active={query.date === today()} onPress={() => setQuery({ ...query, date: today() })} />
          <Chip label="Yarın" active={query.date === addDays(today(), 1)} onPress={() => setQuery({ ...query, date: addDays(today(), 1) })} />
        </View>
      </View>
      <Button label={loading ? 'Tüm sitelerde aranıyor…' : 'Tüm sitelerde ara'} icon={Search} size="lg" onPress={() => runSearch()} disabled={loading} />

      {error ? (
        <Animated.View entering={FadeIn} className="mt-3 flex-row items-center gap-2 rounded-xl bg-bad-soft p-3 dark:bg-bad/20">
          <CircleAlert size={16} color={palette.bad} />
          <Text className="flex-1 text-bad">{error}</Text>
        </Animated.View>
      ) : null}
      {loading ? <ActivityIndicator style={{ marginTop: 20 }} color={palette.brand} /> : null}

      {result && !loading ? (
        <>
          {result.errors?.map((e) => (
            <Text key={e.provider} className="mt-2 rounded-lg bg-warn-soft p-2 text-xs text-warn dark:bg-warn/25 dark:text-amber-300">
              {e.provider}: {e.message}
            </Text>
          ))}

          {advice ? (
            <Animated.View entering={FadeInUp.duration(300)}>
              <Card className="mt-3">
                <View className="mb-1.5 flex-row items-center gap-1.5">
                  <Sparkles size={15} color={palette.brand} />
                  <Text className="font-bold text-ink dark:text-white">Asistanın önerisi</Text>
                </View>
                <Text className="leading-5 text-ink dark:text-white">{advice.text}</Text>
              </Card>
            </Animated.View>
          ) : null}

          <PriceChart trips={chartTrips} onSelectRange={selectRange} selected={filters.departAfter} />

          <View className="mt-3.5 flex-row items-center justify-between">
            <Text className="flex-1 text-[13px] text-ink-muted dark:text-night-muted">
              {trips.length}/{stats.total} bilet · {stats.soldOut} dolu
              {stats.cheapest ? ` · en ucuz ${formatPrice(stats.cheapest.price)}` : ''}
            </Text>
            <Button
              icon={SlidersHorizontal}
              label={`Filtreler${activeFilters ? ` (${activeFilters})` : ''}`}
              variant={activeFilters ? 'primary' : 'outline'}
              size="sm"
              onPress={() => setShowFilters(true)}
            />
          </View>

          {alarm ? (
            <Animated.View entering={FadeInUp.duration(250)}>
              <Card className="my-2.5">
                <Text className="mb-1 font-bold text-ink dark:text-white">Alarm: bu arama ve filtreler takip edilsin</Text>
                <Text className="my-1.5 text-xs text-ink-muted dark:text-night-muted">Kontrol sıklığı</Text>
                <View className="flex-row flex-wrap">
                  {INTERVALS.map((m) => (
                    <Chip key={m} label={`${m} dk`} active={alarm.intervalMin === m} onPress={() => setAlarm({ ...alarm, intervalMin: m })} />
                  ))}
                </View>
                <Text className="my-1.5 text-xs text-ink-muted dark:text-night-muted">Ne zaman haber vereyim?</Text>
                <View className="flex-row flex-wrap">
                  {NOTIFY.map(([v, l]) => (
                    <Chip
                      key={v}
                      label={l}
                      active={alarm.notifyOn.includes(v)}
                      onPress={() => setAlarm({ ...alarm, notifyOn: alarm.notifyOn.includes(v) ? alarm.notifyOn.filter((x) => x !== v) : [...alarm.notifyOn, v] })}
                    />
                  ))}
                </View>
                <Row className="mt-1.5">
                  <Button label="Alarmı kaydet" icon={BellRing} onPress={createAlarm} disabled={!alarm.notifyOn.length} className="flex-1" />
                  <Button label="Vazgeç" variant="outline" onPress={() => setAlarm(null)} />
                </Row>
              </Card>
            </Animated.View>
          ) : (
            <Button
              label="Dolu biletler boşalınca haber ver"
              icon={BellRing}
              variant="soft"
              onPress={() => setAlarm({ intervalMin: 5, notifyOn: ['freed', 'seats_up', 'price_drop'] })}
              className="my-2.5"
            />
          )}
        </>
      ) : null}

      <FilterPanel
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onChange={setFilters}
        providers={modeProviders}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        resultCount={trips.length}
      />
    </View>
  );

  return (
    <FlatList
      data={loading ? [] : trips}
      keyExtractor={(t) => t.id}
      renderItem={({ item, index }) => <TripCard trip={item} index={index} cheapest={item === stats.cheapest} />}
      ListHeaderComponent={header}
      ListEmptyComponent={result && !loading ? <Text className="mt-5 text-center text-ink-muted dark:text-night-muted">Bu filtrelere uyan bilet yok.</Text> : null}
      contentContainerClassName="p-4 pb-10"
      keyboardShouldPersistTaps="handled"
    />
  );
}

import { Ban, BellRing, Bus, TrainFront, Clock, Pause, PartyPopper, Plane, Play, Plus, RefreshCw, Armchair, Trash2, TrendingDown } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Badge, Button, Card, SectionTitle } from '../components/ui';
import { label } from '../dates';
import { cn } from '../lib/cn';
import { usePalette } from '../theme';

const EVENT_STYLE = {
  freed: { Icon: PartyPopper, tone: 'ok' },
  seats_up: { Icon: Armchair, tone: 'ok' },
  price_drop: { Icon: TrendingDown, tone: 'brand' },
  new: { Icon: Plus, tone: 'brand' },
  soldout: { Icon: Ban, tone: 'bad' },
};
const TONE_CLASSES = { ok: 'bg-ok-soft dark:bg-ok/20', brand: 'bg-brand-soft dark:bg-brand/25', bad: 'bg-bad-soft dark:bg-bad/20' };

function ago(iso) {
  if (!iso) return 'henüz kontrol edilmedi';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return min < 1 ? 'az önce' : min < 60 ? `${min} dk önce` : `${Math.round(min / 60)} sa önce`;
}

export default function WatchesScreen({ api, events, refreshEvents }) {
  const palette = usePalette();
  const [watches, setWatches] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setWatches(await api.watches());
      await refreshEvents();
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, [api, refreshEvents]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = (fn) => async () => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      Alert.alert('Hata', err.message);
    }
  };

  return (
    <ScrollView contentContainerClassName="p-4 pb-10" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {error ? <Text className="mb-2 text-bad">{error}</Text> : null}
      <SectionTitle>Alarmlarım ({watches.length})</SectionTitle>
      {!watches.length ? (
        <Card className="items-center py-6">
          <BellRing size={28} color={palette.muted} />
          <Text className="mt-2 text-center text-ink-muted dark:text-night-muted">
            Henüz alarm yok. Arama sonuçlarında "Dolu biletler boşalınca haber ver"e dokunun.
          </Text>
        </Card>
      ) : null}

      {watches.map((w, i) => {
        const ModeIcon = { bus: Bus, train: TrainFront, flight: Plane }[w.mode] ?? Bus;
        const f = w.filters ?? {};
        return (
          <Animated.View key={w.id} entering={FadeInDown.delay(i * 50)} layout={LinearTransition}>
            <Card className={cn('mb-2.5', w.paused && 'opacity-60')}>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <ModeIcon size={18} color={palette.brand} />
                  <Text className="text-base font-bold text-ink dark:text-white">
                    {w.from} → {w.to}
                  </Text>
                </View>
                <Badge tone={w.paused ? 'warn' : 'ok'}>{w.paused ? 'DURAKLADI' : 'AKTİF'}</Badge>
              </View>
              <View className="mt-1.5 flex-row items-center gap-1">
                <Clock size={12} color={palette.muted} />
                <Text className="text-xs text-ink-muted dark:text-night-muted">
                  {label(w.date)} · her {w.intervalMin} dk · {ago(w.lastCheckedAt)}
                  {w.lastCount !== null ? ` · ${w.lastCount} sefer` : ''}
                </Text>
              </View>
              {f.departAfter || f.departBefore || f.priceMax ? (
                <View className="mt-2 flex-row flex-wrap gap-1.5">
                  {f.departAfter || f.departBefore ? <Badge tone="brand">{`${f.departAfter ?? '00:00'}–${f.departBefore ?? '23:59'}`}</Badge> : null}
                  {f.priceMax ? <Badge tone="brand">{`≤ ${f.priceMax} ₺`}</Badge> : null}
                </View>
              ) : null}
              {w.lastError ? <Text className="mt-1.5 text-xs text-warn">{w.lastError}</Text> : null}
              <View className="mt-3 flex-row gap-2">
                <Button label="Kontrol et" icon={RefreshCw} variant="soft" size="sm" onPress={run(() => api.checkWatch(w.id))} />
                <Button
                  label={w.paused ? 'Devam' : 'Duraklat'}
                  icon={w.paused ? Play : Pause}
                  variant="outline"
                  size="sm"
                  onPress={run(() => api.updateWatch(w.id, { paused: !w.paused }))}
                />
                <Button
                  icon={Trash2}
                  variant="danger"
                  size="sm"
                  onPress={() =>
                    Alert.alert('Alarm silinsin mi?', `${w.from} → ${w.to}`, [
                      { text: 'Vazgeç', style: 'cancel' },
                      { text: 'Sil', style: 'destructive', onPress: run(() => api.deleteWatch(w.id)) },
                    ])
                  }
                />
              </View>
            </Card>
          </Animated.View>
        );
      })}

      <SectionTitle>Son bildirimler</SectionTitle>
      {!events.length ? <Text className="text-xs text-ink-muted dark:text-night-muted">Bir değişiklik olunca burada göreceksiniz.</Text> : null}
      {events.map((e, i) => {
        const { Icon, tone } = EVENT_STYLE[e.type] ?? EVENT_STYLE.new;
        return (
          <Animated.View key={e.id} entering={FadeInDown.delay(Math.min(i, 8) * 40)}>
            <Pressable onPress={() => e.trip?.url && Linking.openURL(e.trip.url)}>
              <Card className="mb-2 flex-row gap-3">
                <View className={cn('h-9 w-9 items-center justify-center rounded-full', TONE_CLASSES[tone])}>
                  <Icon size={18} color={palette[tone === 'brand' ? 'brand' : tone]} />
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-ink dark:text-white">{e.title}</Text>
                  <Text className="mt-0.5 text-[13px] text-ink dark:text-white">{e.message}</Text>
                  <Text className="mt-1 text-xs text-ink-muted dark:text-night-muted">{ago(e.at)}</Text>
                </View>
              </Card>
            </Pressable>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

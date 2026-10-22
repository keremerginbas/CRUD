import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Row, SectionTitle } from '../components/ui';
import { label } from '../dates';
import { colors } from '../theme';

const EVENT_STYLE = {
  freed: { icon: '🎉', color: colors.success },
  seats_up: { icon: '💺', color: colors.success },
  price_drop: { icon: '📉', color: colors.primary },
  new: { icon: '🆕', color: colors.primary },
  soldout: { icon: '⛔', color: colors.danger },
};

function ago(iso) {
  if (!iso) return 'henüz kontrol edilmedi';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return min < 1 ? 'az önce' : min < 60 ? `${min} dk önce` : `${Math.round(min / 60)} sa önce`;
}

export default function WatchesScreen({ api, events, refreshEvents }) {
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
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SectionTitle>Alarmlarım ({watches.length})</SectionTitle>
      {!watches.length ? <Text style={styles.muted}>Henüz alarm yok. Arama sonuçlarından "Boşalınca haber ver" ile kurabilirsiniz.</Text> : null}
      {watches.map((w) => (
        <View key={w.id} style={[styles.card, w.paused && { opacity: 0.6 }]}>
          <Text style={styles.title}>
            {w.mode === 'bus' ? '🚌' : '✈️'} {w.from} → {w.to}
          </Text>
          <Text style={styles.muted}>
            {label(w.date)} · her {w.intervalMin} dk · {ago(w.lastCheckedAt)}
            {w.lastCount !== null ? ` · ${w.lastCount} sefer` : ''}
          </Text>
          {w.filters?.departAfter || w.filters?.departBefore || w.filters?.priceMax ? (
            <Text style={styles.muted}>
              {w.filters.departAfter || w.filters.departBefore ? `Saat ${w.filters.departAfter ?? '00:00'}–${w.filters.departBefore ?? '23:59'}  ` : ''}
              {w.filters.priceMax ? `En fazla ${w.filters.priceMax} ₺` : ''}
            </Text>
          ) : null}
          {w.lastError ? <Text style={styles.warning}>{w.lastError}</Text> : null}
          <Row style={{ marginTop: 8 }}>
            <Button label="Şimdi kontrol et" variant="ghost" onPress={run(() => api.checkWatch(w.id))} style={styles.small} />
            <Button label={w.paused ? 'Devam' : 'Duraklat'} variant="ghost" onPress={run(() => api.updateWatch(w.id, { paused: !w.paused }))} style={styles.small} />
            <Button
              label="Sil"
              variant="danger"
              style={styles.small}
              onPress={() =>
                Alert.alert('Alarm silinsin mi?', `${w.from} → ${w.to}`, [
                  { text: 'Vazgeç', style: 'cancel' },
                  { text: 'Sil', style: 'destructive', onPress: run(() => api.deleteWatch(w.id)) },
                ])
              }
            />
          </Row>
        </View>
      ))}

      <SectionTitle>Son bildirimler</SectionTitle>
      {!events.length ? <Text style={styles.muted}>Bir değişiklik olunca burada göreceksiniz.</Text> : null}
      {events.map((e) => {
        const s = EVENT_STYLE[e.type] ?? EVENT_STYLE.new;
        return (
          <Pressable key={e.id} style={styles.event} onPress={() => e.trip?.url && Linking.openURL(e.trip.url)}>
            <Text style={styles.eventIcon}>{s.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eventTitle, { color: s.color }]}>{e.title}</Text>
              <Text style={styles.eventText}>{e.message}</Text>
              <Text style={styles.muted}>{ago(e.at)}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 12, marginTop: 3 },
  warning: { color: colors.warning, fontSize: 12, marginTop: 6 },
  error: { color: colors.danger, marginBottom: 8 },
  small: { paddingVertical: 8, paddingHorizontal: 10 },
  event: { flexDirection: 'row', gap: 10, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  eventIcon: { fontSize: 22 },
  eventTitle: { fontWeight: '700' },
  eventText: { color: colors.text, marginTop: 2, fontSize: 13 },
});

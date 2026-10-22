import { Car, Map, MapPin, Navigation, Route } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { usePalette } from '../theme';
import RouteMap from './RouteMap';
import { Badge, Button, Card } from './ui';

function hours(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} sa${m ? ` ${m} dk` : ''}` : `${m} dk`;
}

const MODE_NOTE = {
  bus: 'Otobüs molalar nedeniyle genelde biraz daha uzun sürer; seferlerin kendi süreleri kartlarda yazıyor.',
  train: 'Demiryolu güzergâhı yaklaşık olarak düz çizgiyle gösterilir.',
  flight: 'Uçuş rotası kuş uçuşu olarak gösterilir.',
};

// Nereden → nereye: mesafe, arabayla süre, geçilen otoyollar, harita ve
// Google Maps / Yandex Maps'te açma butonları
export default function RouteCard({ api, mode, from, to, tripDurations = [] }) {
  const palette = usePalette();
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);
  const [showMap, setShowMap] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRoute(null);
    setError(null);
    api
      .route({ from, to, mode })
      .then((r) => !cancelled && setRoute(r))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [api, mode, from, to]);

  const durations = tripDurations.filter(Boolean);
  const typical = durations.length ? [Math.min(...durations), Math.max(...durations)] : null;

  return (
    <Card className="mt-3">
      <View className="flex-row items-center gap-1.5">
        <Route size={16} color={palette.brand} />
        <Text className="font-bold text-ink dark:text-white">Güzergâh</Text>
        <Text className="flex-1 text-right text-xs text-ink-muted dark:text-night-muted" numberOfLines={1}>
          {from} → {to}
        </Text>
      </View>

      {error ? <Text className="mt-2 text-xs text-warn">{error}</Text> : null}
      {!route && !error ? <ActivityIndicator style={{ marginVertical: 12 }} color={palette.brand} /> : null}

      {route ? (
        <>
          <View className="mt-3 flex-row gap-2">
            <View className="flex-1 rounded-xl bg-surface-bg p-2.5 dark:bg-night">
              <Text className="text-xs text-ink-muted dark:text-night-muted">{route.straight ? 'Kuş uçuşu' : 'Karayolu mesafesi'}</Text>
              <Text className="text-lg font-bold text-ink dark:text-white">{route.distanceKm} km</Text>
            </View>
            {route.driveMin ? (
              <View className="flex-1 rounded-xl bg-surface-bg p-2.5 dark:bg-night">
                <View className="flex-row items-center gap-1">
                  <Car size={12} color={palette.muted} />
                  <Text className="text-xs text-ink-muted dark:text-night-muted">Arabayla</Text>
                </View>
                <Text className="text-lg font-bold text-ink dark:text-white">{hours(route.driveMin)}</Text>
              </View>
            ) : null}
            {typical ? (
              <View className="flex-1 rounded-xl bg-surface-bg p-2.5 dark:bg-night">
                <Text className="text-xs text-ink-muted dark:text-night-muted">Seferler</Text>
                <Text className="text-lg font-bold text-ink dark:text-white" numberOfLines={1} adjustsFontSizeToFit>
                  {typical[0] === typical[1] ? hours(typical[0]) : `${Math.round(typical[0] / 6) / 10}–${Math.round(typical[1] / 6) / 10} sa`}
                </Text>
              </View>
            ) : null}
          </View>

          {route.highways.length ? (
            <View className="mt-3">
              <Text className="mb-1.5 text-xs font-semibold text-ink-muted dark:text-night-muted">Geçtiği yollar</Text>
              {route.highways.slice(0, 6).map((h) => (
                <View key={h.ref} className="mb-1 flex-row items-center gap-2">
                  <Badge tone={h.type.startsWith('Otoyol') ? 'warn' : h.type === 'Devlet yolu' ? 'brand' : 'ok'}>{h.ref}</Badge>
                  <Text className="flex-1 text-[13px] text-ink dark:text-white" numberOfLines={1}>
                    {h.name && h.name !== h.ref ? `${h.name} · ` : ''}
                    {h.type}
                  </Text>
                  <Text className="text-xs text-ink-muted dark:text-night-muted">{h.km} km</Text>
                </View>
              ))}
            </View>
          ) : null}

          {showMap ? (
            <View className="mt-3 h-52 overflow-hidden rounded-xl border border-surface-line dark:border-night-line">
              <RouteMap url={api.mapUrl({ from, to, mode })} />
            </View>
          ) : null}

          <Text className="mt-2 text-xs leading-4 text-ink-muted dark:text-night-muted">{MODE_NOTE[mode]}</Text>

          <View className="mt-3 flex-row flex-wrap gap-2">
            <Button label="Google Maps" icon={MapPin} variant="outline" size="sm" onPress={() => Linking.openURL(route.links.google)} />
            <Button label="Yandex Maps" icon={Navigation} variant="outline" size="sm" onPress={() => Linking.openURL(route.links.yandex)} />
            <Button label={showMap ? 'Haritayı gizle' : 'Harita'} icon={Map} variant="soft" size="sm" onPress={() => setShowMap(!showMap)} />
          </View>
        </>
      ) : null}
    </Card>
  );
}

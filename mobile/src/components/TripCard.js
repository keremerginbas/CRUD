import { Armchair, Clock, ExternalLink } from 'lucide-react-native';
import { Linking, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { cn } from '../lib/cn';
import { providerColors, usePalette } from '../theme';
import { Badge, PressableScale } from './ui';

function duration(min) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} sa ${m ? `${m} dk` : ''}`.trim() : `${m} dk`;
}

export function formatPrice(price, currency = 'TRY') {
  if (price === null || price === undefined) return '—';
  return `${Math.round(price).toLocaleString('tr-TR')} ${currency === 'TRY' ? '₺' : currency}`;
}

function status(trip) {
  if (trip.soldOut) return { tone: 'bad', text: 'DOLU' };
  if (trip.seatsAvailable === null) return { tone: 'ok', text: 'Müsait' };
  return { tone: trip.seatsAvailable <= 3 ? 'warn' : 'ok', text: `${trip.seatsAvailable} boş koltuk` };
}

export default function TripCard({ trip, cheapest, index = 0 }) {
  const palette = usePalette();
  const color = providerColors[trip.provider] ?? palette.brand;
  const s = status(trip);

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(250)}>
      <PressableScale
        onPress={() => trip.url && Linking.openURL(trip.url)}
        accessibilityHint={trip.url ? 'Bileti sitede açar' : undefined}
        className={cn(
          'mb-2.5 flex-row overflow-hidden rounded-xl2 border bg-surface dark:bg-night-card',
          cheapest ? 'border-brand' : 'border-surface-line dark:border-night-line',
          trip.soldOut && 'opacity-70',
        )}
      >
        <View className="w-1.5" style={{ backgroundColor: color }} />
        <View className="flex-1 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-bold text-ink dark:text-white">
              {trip.departure.slice(11, 16)}
              {trip.arrival ? <Text className="text-[15px] font-medium text-ink-muted dark:text-night-muted">{`  →  ${trip.arrival.slice(11, 16)}`}</Text> : null}
            </Text>
            <Text className={cn('text-lg font-bold', trip.soldOut ? 'text-ink-muted line-through' : cheapest ? 'text-brand' : 'text-ink dark:text-white')}>
              {formatPrice(trip.price, trip.currency)}
            </Text>
          </View>

          <View className="mt-1 flex-row items-center gap-1.5">
            <Text className="shrink text-sm text-ink dark:text-white" numberOfLines={1}>
              {trip.company}
            </Text>
            {duration(trip.durationMin) ? (
              <>
                <Clock size={13} color={palette.muted} />
                <Text className="text-[13px] text-ink-muted dark:text-night-muted">{duration(trip.durationMin)}</Text>
              </>
            ) : null}
          </View>

          <View className="mt-2 flex-row items-center justify-between">
            <View className="flex-row items-center gap-1">
              <Text className="text-xs font-bold" style={{ color }}>
                {trip.providerName}
              </Text>
              {trip.url ? <ExternalLink size={11} color={color} /> : null}
            </View>
            <View className="flex-row items-center gap-1.5">
              {cheapest ? <Badge tone="brand">EN UCUZ</Badge> : null}
              <View className="flex-row items-center gap-1">
                {!trip.soldOut && trip.seatsAvailable !== null ? <Armchair size={12} color={s.tone === 'warn' ? palette.warn : palette.ok} /> : null}
                <Badge tone={s.tone}>{s.text}</Badge>
              </View>
            </View>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

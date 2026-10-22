import { Text, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { useState } from 'react';
import { usePalette } from '../theme';
import { formatPrice } from './TripCard';
import { Card } from './ui';

const BUCKETS = [0, 3, 6, 9, 12, 15, 18, 21];
const pad = (n) => String(n).padStart(2, '0');

// Günün 3 saatlik dilimlerinde en ucuz müsait bilet. Bir çubuğa dokununca
// kalkış saati filtresi o dilime ayarlanır.
export default function PriceChart({ trips, onSelectRange, selected }) {
  const palette = usePalette();
  const [width, setWidth] = useState(0);

  const bars = BUCKETS.map((h) => {
    const inBucket = trips.filter((t) => !t.soldOut && t.price !== null && Number(t.departure.slice(11, 13)) >= h && Number(t.departure.slice(11, 13)) < h + 3);
    const min = inBucket.length ? Math.min(...inBucket.map((t) => t.price)) : 0;
    return { h, min, count: inBucket.length };
  });
  const prices = bars.filter((b) => b.min).map((b) => b.min);
  if (prices.length < 2) return null;
  const cheapest = Math.min(...prices);

  const range = (h) => [`${pad(h)}:00`, h === 21 ? '23:59' : `${pad(h + 3)}:00`];
  const data = bars.map((b) => {
    const [after] = range(b.h);
    const isSelected = selected === after;
    return {
      value: b.min,
      label: pad(b.h),
      frontColor: !b.min ? palette.line : isSelected ? palette.ok : b.min === cheapest ? palette.brand : `${palette.brand}66`,
      onPress: () => b.min && onSelectRange?.(...range(b.h)),
    };
  });

  const slots = data.length;
  const barWidth = width ? Math.max(14, (width - 44) / slots - 10) : 18;

  return (
    <Card className="mt-3">
      <Text className="text-sm font-bold text-ink dark:text-white">Saate göre en ucuz fiyat</Text>
      <Text className="mb-2 text-xs text-ink-muted dark:text-night-muted">
        En ucuz {formatPrice(cheapest)} · bir çubuğa dokunup o saat aralığını filtreleyin
      </Text>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width ? (
          <BarChart
            data={data}
            height={110}
            width={width - 44}
            barWidth={barWidth}
            spacing={10}
            initialSpacing={6}
            barBorderRadius={5}
            noOfSections={3}
            yAxisThickness={0}
            xAxisColor={palette.line}
            rulesColor={palette.line}
            yAxisTextStyle={{ color: palette.muted, fontSize: 10 }}
            xAxisLabelTextStyle={{ color: palette.muted, fontSize: 10 }}
            yAxisLabelWidth={38}
            formatYLabel={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 100) / 10}b` : String(Math.round(Number(v))))}
            disableScroll
            isAnimated
          />
        ) : null}
      </View>
    </Card>
  );
}

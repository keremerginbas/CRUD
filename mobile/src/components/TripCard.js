import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, providerColors } from '../theme';

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

export default function TripCard({ trip, cheapest }) {
  const color = providerColors[trip.provider] ?? colors.primary;
  const status = trip.soldOut
    ? { text: 'DOLU', bg: colors.dangerSoft, fg: colors.danger }
    : trip.seatsAvailable !== null
      ? { text: `${trip.seatsAvailable} boş koltuk`, bg: trip.seatsAvailable <= 3 ? colors.warningSoft : colors.successSoft, fg: trip.seatsAvailable <= 3 ? colors.warning : colors.success }
      : { text: 'Müsait', bg: colors.successSoft, fg: colors.success };

  return (
    <Pressable
      style={[styles.card, trip.soldOut && styles.soldOut]}
      onPress={() => trip.url && Linking.openURL(trip.url)}
      accessibilityHint={trip.url ? 'Bileti sitede açar' : undefined}
    >
      <View style={[styles.stripe, { backgroundColor: color }]} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.time}>
            {trip.departure.slice(11, 16)}
            {trip.arrival ? <Text style={styles.arrow}>{`  →  ${trip.arrival.slice(11, 16)}`}</Text> : null}
          </Text>
          <Text style={[styles.price, trip.soldOut && { color: colors.muted }]}>{formatPrice(trip.price, trip.currency)}</Text>
        </View>
        <Text style={styles.company} numberOfLines={1}>
          {trip.company}
          {duration(trip.durationMin) ? <Text style={styles.muted}>{`  ·  ${duration(trip.durationMin)}`}</Text> : null}
        </Text>
        <View style={styles.bottom}>
          <Text style={[styles.provider, { color }]}>{trip.providerName}</Text>
          <View style={styles.badges}>
            {cheapest ? <Text style={[styles.badge, { backgroundColor: colors.primarySoft, color: colors.primary }]}>EN UCUZ</Text> : null}
            <Text style={[styles.badge, { backgroundColor: status.bg, color: status.fg }]}>{status.text}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  soldOut: { opacity: 0.75 },
  stripe: { width: 5 },
  body: { flex: 1, padding: 12 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontSize: 18, fontWeight: '700', color: colors.text },
  arrow: { fontSize: 15, fontWeight: '500', color: colors.muted },
  price: { fontSize: 18, fontWeight: '700', color: colors.text },
  company: { marginTop: 4, fontSize: 14, color: colors.text },
  muted: { color: colors.muted },
  bottom: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  provider: { fontSize: 12, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: 6 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
});

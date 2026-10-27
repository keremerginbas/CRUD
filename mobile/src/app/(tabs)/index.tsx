import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Center, styles } from '../../components/ui';
import { formatDate, formatDuration } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { Call } from '../../lib/types';
import { useApi } from '../../lib/useApi';
import { colors } from '../../theme';

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'inbound', label: 'Gelen' },
  { key: 'outbound', label: 'Giden' },
  { key: 'missed', label: 'Cevapsız' },
] as const;

function callIcon(c: Call) {
  if (c.status === 'missed' || c.status === 'failed') return { name: 'call-outline' as const, color: colors.danger };
  return c.direction === 'inbound'
    ? { name: 'arrow-down-outline' as const, color: colors.green }
    : { name: 'arrow-up-outline' as const, color: colors.blue };
}

export default function Calls() {
  const { user } = useSession();
  const manager = user?.role !== 'danisman';
  const [scopeAll, setScopeAll] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const { data, error, loading, reload } = useApi<Call[]>(`/api/calls${scopeAll ? '?scope=all' : ''}`);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const calls = (data ?? []).filter((c) =>
    filter === 'all' ? true : filter === 'missed' ? c.status === 'missed' : c.direction === filter);

  return (
    <View style={styles.screen}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 14 }}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 44, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: colors.text,
              alignItems: 'center', justifyContent: 'center', backgroundColor: filter === f.key ? colors.text : 'transparent',
            }}>
              <Text style={{ color: filter === f.key ? colors.bg : colors.text, fontSize: 18 }}>{f.label[0]}</Text>
            </View>
            <Text style={styles.muted}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {manager && (
        <Pressable onPress={() => setScopeAll(!scopeAll)} style={{ alignSelf: 'center', paddingBottom: 10 }}>
          <Text style={{ color: colors.accent }}>{scopeAll ? 'Tüm ofisin çağrıları' : 'Sadece benim çağrılarım'} ▾</Text>
        </Pressable>
      )}
      <FlatList
        data={calls}
        keyExtractor={(c) => String(c.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
        ListEmptyComponent={loading ? undefined : <Center><Text style={styles.muted}>{error ?? 'Henüz çağrı yok'}</Text></Center>}
        renderItem={({ item: c }) => {
          const ic = callIcon(c);
          return (
            <Pressable onPress={() => router.push(`/call/${c.id}`)} style={[styles.row, { flexDirection: 'row', gap: 14 }]}>
              <Ionicons name={ic.name} size={22} color={ic.color} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.text, { color: ic.color }]}>{c.contact_name ?? c.customer_phone}</Text>
                <Text style={styles.muted}>{c.dialed_label ?? c.dialed_number ?? '—'}{scopeAll && c.user_name ? ` · ${c.user_name}` : ''}</Text>
                <Text style={styles.muted}>{formatDate(c.started_at)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <Text style={styles.muted}>{c.duration_sec ? formatDuration(c.duration_sec) : ''}</Text>
                {c.recording_ref && <Ionicons name="mic-outline" size={16} color={colors.muted} />}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

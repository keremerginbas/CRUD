import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, TextInput, View } from 'react-native';
import { Center, styles } from '../../components/ui';
import { startMaskedCall } from '../../lib/calls';
import { formatDate } from '../../lib/format';
import type { Contact } from '../../lib/types';
import { useApi } from '../../lib/useApi';
import { colors } from '../../theme';

export default function Contacts() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, loading, reload } = useApi<Contact[]>(`/api/contacts?q=${encodeURIComponent(query)}`);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const sections = useMemo(() => {
    const groups = new Map<string, Contact[]>();
    for (const c of data ?? []) {
      const letter = c.name[0]?.toLocaleUpperCase('tr-TR') ?? '#';
      groups.set(letter, [...(groups.get(letter) ?? []), c]);
    }
    return [...groups].map(([title, items]) => ({ title, data: items }));
  }, [data]);

  return (
    <View style={styles.screen}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="ara"
          placeholderTextColor={colors.muted}
          style={[styles.input, { flex: 1 }]}
        />
        <Pressable onPress={() => router.push('/contact-new')} accessibilityLabel="Yeni kişi">
          <Ionicons name="add-circle" size={36} color={colors.accent} />
        </Pressable>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(c) => String(c.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
        ListEmptyComponent={loading ? undefined : <Center><Text style={styles.muted}>{error ?? 'Kişi bulunamadı'}</Text></Center>}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.muted, { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 6, backgroundColor: colors.bg }]}>{section.title}</Text>
        )}
        renderItem={({ item: c }) => (
          <View style={[styles.row, { flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.text}>{c.name}</Text>
              <Text style={styles.muted}>{c.phone}</Text>
              <Text style={styles.muted}>{formatDate(c.created_at)}</Text>
              <Text style={[styles.muted, { marginTop: 6 }]}>{c.type}</Text>
            </View>
            <Pressable
              onPress={() => startMaskedCall({ contactId: c.id, name: c.name })}
              style={{ padding: 10 }}
              accessibilityLabel={`${c.name} kişisini ara`}
            >
              <Ionicons name="call" size={24} color={colors.green} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

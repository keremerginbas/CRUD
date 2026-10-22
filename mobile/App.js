import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createApi } from './src/api';
import { ensurePermission, showEventNotification } from './src/notifications';
import SearchScreen from './src/screens/SearchScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import WatchesScreen from './src/screens/WatchesScreen';
import { load, save } from './src/storage';
import { colors } from './src/theme';

const POLL_MS = 60_000;

export default function App() {
  const [tab, setTab] = useState('search');
  const [serverUrl, setServerUrl] = useState(null);
  const [health, setHealth] = useState(null);
  const [providers, setProviders] = useState([]);
  const [events, setEvents] = useState([]);
  const [unread, setUnread] = useState(0);
  const lastEventAt = useRef(null);
  const api = useMemo(() => createApi(serverUrl), [serverUrl]);

  useEffect(() => {
    Promise.all([load('serverUrl', ''), load('lastEventAt', null)]).then(([url, last]) => {
      lastEventAt.current = last;
      setServerUrl(url);
      if (!url) setTab('settings');
    });
    ensurePermission().catch(() => {});
  }, []);

  useEffect(() => {
    if (!serverUrl) return;
    api.health().then(setHealth).catch(() => setHealth(null));
    api.providers().then(setProviders).catch(() => setProviders([]));
  }, [api, serverUrl]);

  // Sunucudaki yeni alarm olaylarını çek, yeni olanlar için bildirim göster
  const refreshEvents = useCallback(async () => {
    if (!serverUrl) return;
    const list = await api.events({ limit: 50 });
    setEvents(list);
    const fresh = list.filter((e) => !lastEventAt.current || e.at > lastEventAt.current);
    if (fresh.length && lastEventAt.current) {
      fresh.slice(0, 5).forEach(showEventNotification);
      setUnread((n) => n + fresh.length);
    }
    if (list[0]) {
      lastEventAt.current = list[0].at;
      save('lastEventAt', list[0].at);
    } else if (!lastEventAt.current) {
      lastEventAt.current = new Date().toISOString();
    }
  }, [api, serverUrl]);

  useEffect(() => {
    if (!serverUrl) return;
    const poll = () => refreshEvents().catch(() => {});
    poll();
    const timer = setInterval(() => AppState.currentState === 'active' && poll(), POLL_MS);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && poll());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refreshEvents, serverUrl]);

  if (serverUrl === null) return null;

  const tabs = [
    ['search', '🔎', 'Ara'],
    ['watches', '🔔', unread ? `Alarmlar (${unread})` : 'Alarmlar'],
    ['settings', '⚙️', 'Ayarlar'],
  ];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <Text style={styles.brand}>Bilet Radar</Text>
          {health?.demo ? <Text style={styles.demo}>DEMO</Text> : null}
        </View>
        <View style={styles.content}>
          {tab === 'search' ? (
            <SearchScreen api={api} providers={providers} aiEnabled={health?.ai} onWatchCreated={() => setTab('watches')} />
          ) : tab === 'watches' ? (
            <WatchesScreen api={api} events={events} refreshEvents={refreshEvents} />
          ) : (
            <SettingsScreen serverUrl={serverUrl} onSave={(url) => { setServerUrl(url); save('serverUrl', url); }} health={health} providers={providers} />
          )}
        </View>
        <View style={styles.tabs}>
          {tabs.map(([id, icon, text]) => (
            <Pressable
              key={id}
              style={styles.tab}
              onPress={() => {
                setTab(id);
                if (id === 'watches') setUnread(0);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
            >
              <Text style={styles.tabIcon}>{icon}</Text>
              <Text style={[styles.tabText, tab === id && styles.tabActive]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  brand: { fontSize: 22, fontWeight: '800', color: colors.text },
  demo: { fontSize: 11, fontWeight: '700', color: colors.warning, backgroundColor: colors.warningSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  content: { flex: 1 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabIcon: { fontSize: 18 },
  tabText: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tabActive: { color: colors.primary, fontWeight: '700' },
});

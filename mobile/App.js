import './global.css';
import { StatusBar } from 'expo-status-bar';
import { Bell, Radar, Search, Settings } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createApi } from './src/api';
import { ensurePermission, showEventNotification } from './src/notifications';
import SearchScreen from './src/screens/SearchScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import WatchesScreen from './src/screens/WatchesScreen';
import { load, save } from './src/storage';
import { cn } from './src/lib/cn';
import { usePalette } from './src/theme';

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
  const palette = usePalette();

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
    ['search', Search, 'Ara', 0],
    ['watches', Bell, 'Alarmlar', unread],
    ['settings', Settings, 'Ayarlar', 0],
  ];

  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-surface-bg dark:bg-night" edges={['top', 'bottom']}>
        <StatusBar style="auto" />
        <View className="flex-row items-center gap-2 px-4 py-2.5">
          <Radar size={24} color={palette.brand} />
          <Text className="text-[22px] font-extrabold text-ink dark:text-white">Bilet Radar</Text>
          {health?.demo ? <Text className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-bold text-warn dark:bg-warn/25 dark:text-amber-300">DEMO</Text> : null}
        </View>
        <View className="flex-1">
          {tab === 'search' ? (
            <SearchScreen api={api} providers={providers} aiEnabled={health?.ai} onWatchCreated={() => setTab('watches')} />
          ) : tab === 'watches' ? (
            <WatchesScreen api={api} events={events} refreshEvents={refreshEvents} />
          ) : (
            <SettingsScreen
              serverUrl={serverUrl}
              onSave={(url) => {
                setServerUrl(url);
                save('serverUrl', url);
              }}
              health={health}
              providers={providers}
            />
          )}
        </View>
        <View className="flex-row border-t border-surface-line bg-surface dark:border-night-line dark:bg-night-card">
          {tabs.map(([id, Icon, text, badge]) => {
            const active = tab === id;
            return (
              <Pressable
                key={id}
                className="flex-1 items-center py-2"
                onPress={() => {
                  setTab(id);
                  if (id === 'watches') setUnread(0);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <View>
                  <Icon size={22} color={active ? palette.brand : palette.muted} />
                  {badge ? (
                    <View className="absolute -right-2.5 -top-1 min-w-[16px] items-center rounded-full bg-bad px-1">
                      <Text className="text-[10px] font-bold text-white">{badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text className={cn('mt-0.5 text-xs', active ? 'font-bold text-brand' : 'text-ink-muted dark:text-night-muted')}>{text}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import type { ColorValue } from 'react-native';
import { Loading } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors } from '../../theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const { ready, user } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.text, tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
      headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Aramalar', tabBarIcon: icon('call-outline') }} />
      <Tabs.Screen name="contacts" options={{ title: 'Kişiler', tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profilim', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}

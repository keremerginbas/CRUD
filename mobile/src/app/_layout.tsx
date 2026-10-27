import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../lib/session';
import { colors } from '../theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text, border: colors.border },
};

export default function RootLayout() {
  return (
    <SessionProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerTintColor: colors.text, headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="santral" options={{ title: 'santral ayarları' }} />
          <Stack.Screen name="contact-new" options={{ title: 'yeni kişi', presentation: 'modal' }} />
          <Stack.Screen name="call/[id]" options={{ title: 'çağrı detayı' }} />
        </Stack>
      </ThemeProvider>
    </SessionProvider>
  );
}

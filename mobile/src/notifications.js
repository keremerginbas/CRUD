import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Expo Go'da yerel bildirimler çalışır. Uygulama açıkken (veya arka plana yeni alınmışken)
// sunucudaki yeni olaylar bu bildirimlerle gösterilir.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission() {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alarms', {
      name: 'Bilet alarmları',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function showEventNotification(event) {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: event.title, body: event.message, data: { url: event.trip?.url ?? null } },
      trigger: Platform.OS === 'android' ? { channelId: 'alarms' } : null,
    });
  } catch (err) {
    console.warn('Bildirim gösterilemedi', err);
  }
}

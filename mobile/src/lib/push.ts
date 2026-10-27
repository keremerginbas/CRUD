import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// "Müşteri X, ilan Y numaranızı arıyor" ve cevapsız çağrı bildirimleri için
export async function registerForPush() {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('calls', {
      name: 'Çağrılar',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('/api/me/push-token', { method: 'PUT', body: { token: data } });
}

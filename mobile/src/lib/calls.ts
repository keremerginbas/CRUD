import { Alert } from 'react-native';
import { api } from './api';

// Maskeli arama: santral önce sizin telefonunuzu çaldırır, açınca müşteriye dijital numaranızla bağlar
export function startMaskedCall(target: { contactId?: number; phone?: string; name: string }) {
  Alert.alert(target.name, 'Santral üzerinden aransın mı? Müşteri gerçek numaranızı görmez.', [
    { text: 'Vazgeç', style: 'cancel' },
    {
      text: 'Ara',
      onPress: async () => {
        try {
          await api('/api/calls/click-to-call', { method: 'POST', body: { contactId: target.contactId, phone: target.phone } });
          Alert.alert('Arama başlatıldı', 'Telefonunuz birazdan çalacak. Açtığınızda müşteriye bağlanacaksınız.');
        } catch (e) {
          Alert.alert('Arama başlatılamadı', (e as Error).message);
        }
      },
    },
  ]);
}

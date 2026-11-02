import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { api } from '../api';
import { softphone } from '../softphone';

// Tarayıcı telefonu bağlıysa arama panelden yapılır; değilse santral önce danışmanın cebini arar
export function maskedCall(target: { contactId?: number; phone: string; name: string }) {
  if (softphone.getState().status === 'ready') {
    try {
      softphone.call(target.phone, target.name);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Arama başlatılamadı', message: (e as Error).message });
    }
    return;
  }
  modals.openConfirmModal({
    title: `${target.name} aransın mı?`,
    centered: true,
    children: (
      <Text size="sm" c="dimmed">
        Önce sizin telefonunuz çalar, açtığınızda müşteriye bağlanırsınız. Müşteri sizin numaranızı değil, hattınızın numarasını görür.
      </Text>
    ),
    labels: { confirm: 'Ara', cancel: 'Vazgeç' },
    onConfirm: async () => {
      try {
        await api('/api/calls/click-to-call', { method: 'POST', body: { contactId: target.contactId, phone: target.phone } });
        notifications.show({ color: 'lime', title: 'Arama başlatıldı', message: 'Telefonunuz birazdan çalacak.' });
      } catch (e) {
        notifications.show({ color: 'red', title: 'Arama başlatılamadı', message: (e as Error).message });
      }
    },
  });
}

export const toastError = (e: unknown) => notifications.show({ color: 'red', title: 'İşlem yapılamadı', message: (e as Error).message });
export const toastOk = (message: string) => notifications.show({ color: 'lime', message });

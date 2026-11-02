import { ActionIcon, Badge, Button, Group, Modal, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconMicrophone, IconMicrophoneOff, IconPhone, IconPhoneOff } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { formatDuration } from '../format';
import { softphone, useSoftphone } from '../softphone';

const PHASES = { calling: 'Aranıyor…', ringing: 'Çalıyor…', incoming: 'Gelen arama', active: '' };

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return <>{formatDuration(Math.floor((now - since) / 1000))}</>;
}

// Görüşme sırasında ekranın altında duran çubuk ve gelen arama penceresi
export function CallBar() {
  const { call } = useSoftphone();
  if (!call) return null;

  if (call.phase === 'incoming') {
    return (
      <Modal opened onClose={() => softphone.hangup()} withCloseButton={false} centered radius="lg" size="sm">
        <Stack align="center" gap="xs" py="md">
          <Badge color="lime" variant="light">Müşteriniz arıyor</Badge>
          <Text fz="xl" fw={600} tt="uppercase" ta="center">{call.name}</Text>
          {call.name !== call.number && <Text c="dimmed">{call.number}</Text>}
          <Group mt="lg" gap="xl">
            <Button color="red" radius="xl" size="md" leftSection={<IconPhoneOff size={18} />} onClick={() => softphone.hangup()}>Reddet</Button>
            <Button color="lime" radius="xl" size="md" leftSection={<IconPhone size={18} />} onClick={() => softphone.answer()}>Aç</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  return (
    <Paper
      shadow="xl" radius="xl" p="sm" pl="lg" bg="dark.5" withBorder
      style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(84px + env(safe-area-inset-bottom))', zIndex: 300, minWidth: 300, maxWidth: 'calc(100vw - 32px)' }}
    >
      <Group justify="space-between" wrap="nowrap" gap="md">
        <div style={{ minWidth: 0 }}>
          <Text fw={600} tt="uppercase" truncate>{call.name}</Text>
          <Text size="sm" c={call.phase === 'active' ? 'lime.4' : 'dimmed'}>
            {call.phase === 'active' && call.startedAt ? <Timer since={call.startedAt} /> : PHASES[call.phase]}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          {call.phase === 'active' && (
            <Tooltip label={call.muted ? 'Sesi aç' : 'Sessize al'}>
              <ActionIcon size={44} radius="xl" variant={call.muted ? 'filled' : 'light'} color="gray" onClick={() => softphone.toggleMute()} aria-label="Mikrofon">
                {call.muted ? <IconMicrophoneOff size={20} /> : <IconMicrophone size={20} />}
              </ActionIcon>
            </Tooltip>
          )}
          <ActionIcon size={44} radius="xl" color="red" variant="filled" onClick={() => softphone.hangup()} aria-label="Görüşmeyi kapat">
            <IconPhoneOff size={20} />
          </ActionIcon>
        </Group>
      </Group>
    </Paper>
  );
}

// Üst çubuktaki küçük durum göstergesi
export function PhoneStatusDot() {
  const { status, error } = useSoftphone();
  if (status === 'off') return null;
  const map = { ready: ['lime', 'Telefon hazır'], connecting: ['yellow', 'Santrale bağlanıyor'], error: ['red', error ?? 'Santral bağlantısı yok'] } as const;
  const [color, label] = map[status];
  return (
    <Tooltip label={label}>
      <Badge variant="dot" color={color} size="lg" style={{ textTransform: 'none' }}>
        {status === 'ready' ? 'Hazır' : status === 'connecting' ? 'Bağlanıyor' : 'Bağlantı yok'}
      </Badge>
    </Tooltip>
  );
}

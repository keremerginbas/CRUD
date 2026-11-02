import { ActionIcon, AppShell, Center, Group, Loader, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAddressBook, IconLogout, IconPhone, IconSettings, IconUsers, type Icon } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { CallBar, PhoneStatusDot } from './components/CallBar';
import { CallDetail } from './pages/CallDetail';
import { Calls } from './pages/Calls';
import { Contacts } from './pages/Contacts';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Team } from './pages/Team';
import { go, useRoute } from './router';
import { MANAGERS, useSession } from './session';
import { softphone } from './softphone';

type NavItem = { path: string; label: string; icon: Icon; managerOnly?: boolean };
const NAV: NavItem[] = [
  { path: 'aramalar', label: 'Aramalar', icon: IconPhone },
  { path: 'kisiler', label: 'Kişiler', icon: IconAddressBook },
  { path: 'ekip', label: 'Ekip', icon: IconUsers, managerOnly: true },
  { path: 'ayarlar', label: 'Ayarlar', icon: IconSettings },
];

export function App() {
  const { ready, me, logout } = useSession();
  const { page, id } = useRoute();
  const mobile = useMediaQuery('(max-width: 48em)');
  const isManager = !!me && MANAGERS.includes(me.role);
  const items = NAV.filter((n) => !n.managerOnly || isManager);
  const current = page === 'arama' ? 'aramalar' : page;

  useEffect(() => {
    if (me && !items.some((n) => n.path === current)) go('aramalar');
  }, [me, current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Giriş yapınca tarayıcı telefonu santrale bağlanır, çıkışta kapanır
  useEffect(() => {
    if (!me) return;
    softphone.onEnded((reason) => { if (reason) notifications.show({ color: 'red', title: 'Görüşme kurulamadı', message: reason }); });
    softphone.start(me.name);
    return () => softphone.stop();
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Center h="100vh"><Loader /></Center>;
  if (!me) return <Login />;

  const content = page === 'arama' && id ? <CallDetail id={id} />
    : page === 'kisiler' ? <Contacts />
    : page === 'ekip' && isManager ? <Team />
    : page === 'ayarlar' ? <Settings />
    : <Calls />;

  return (
    <AppShell header={{ height: 64 }} footer={mobile ? { height: 64 } : undefined} padding="md">
      <AppShell.Header px="md" style={{ display: 'flex', alignItems: 'center' }}>
        <Group gap="xs" mr="xl">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <Text fw={700} fz="xl">santral</Text>
        </Group>
        {!mobile && (
          <Group gap={4} style={{ flex: 1 }} component="nav">
            {items.map(({ path, label, icon: I }) => (
              <a key={path} href={`#/${path}`} className="nav-link" aria-current={current === path ? 'page' : undefined}>
                <I size={18} stroke={1.6} />{label}
              </a>
            ))}
          </Group>
        )}
        <Group gap="xs" ml="auto">
          <PhoneStatusDot />
          <Text size="sm" c="dimmed" visibleFrom="sm">{me.name}</Text>
          <Tooltip label="Çıkış yap">
            <ActionIcon variant="subtle" color="gray" size="lg" onClick={logout} aria-label="Çıkış yap">
              <IconLogout size={20} stroke={1.6} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 96 }}>{content}</div>
        <CallBar />
      </AppShell.Main>

      {mobile && (
        <AppShell.Footer component="nav" style={{ display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {items.map(({ path, label, icon: I }) => (
            <a key={path} href={`#/${path}`} className="tab-link" aria-current={current === path ? 'page' : undefined}>
              <I size={24} stroke={1.6} />{label}
            </a>
          ))}
        </AppShell.Footer>
      )}
    </AppShell>
  );
}

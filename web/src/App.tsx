import { ActionIcon, AppShell, Avatar, Center, Group, Loader, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { nprogress } from '@mantine/nprogress';
import { spotlight } from '@mantine/spotlight';
import { IconAddressBook, IconBuildingStore, IconCalendarEvent, IconLogout, IconPhone, IconSearch, IconSettings, IconUsers, type Icon } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { CallBar, PhoneStatusDot } from './components/CallBar';
import { QuickSearch } from './components/QuickSearch';
import { Brand } from './components/Brand';
import { SpecialtyGate } from './components/SpecialtyGate';
import { AppointmentReminders } from './components/AppointmentReminders';
import { Appointments } from './pages/Appointments';
import { Listings } from './pages/Listings';
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
  { path: 'randevular', label: 'Randevular', icon: IconCalendarEvent },
  { path: 'ilanlar', label: 'İlanlar', icon: IconBuildingStore },
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

  // Sayfa geçişinde üstte kısa ilerleme çizgisi
  useEffect(() => {
    if (!me) return;
    nprogress.start();
    const t = setTimeout(() => nprogress.complete(), 200);
    return () => clearTimeout(t);
  }, [page, id, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Center h="100vh"><Loader /></Center>;
  if (!me) return <Login />;

  const content = page === 'arama' && id ? <CallDetail id={id} />
    : page === 'kisiler' ? <Contacts />
    : page === 'randevular' ? <Appointments />
    : page === 'ilanlar' ? <Listings />
    : page === 'ekip' && isManager ? <Team />
    : page === 'ayarlar' ? <Settings />
    : <Calls />;

  return (
    <AppShell header={{ height: 64 }} footer={mobile ? { height: 64 } : undefined} padding="md">
      <AppShell.Header px="md" className="app-header" style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ marginRight: 28 }}><Brand href="#/aramalar" /></div>
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
          <button type="button" className="search-hint" onClick={() => spotlight.open()} aria-label="Hızlı ara">
            <IconSearch size={15} /><Text span size="sm" visibleFrom="md">Ara</Text><kbd>Ctrl K</kbd>
          </button>
          <PhoneStatusDot />
          <Tooltip label={me.name}><Avatar name={me.name} color="initials" radius="xl" size={34} /></Tooltip>
          <Tooltip label="Çıkış yap">
            <ActionIcon variant="subtle" color="gray" size="lg" onClick={logout} aria-label="Çıkış yap">
              <IconLogout size={20} stroke={1.6} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <motion.div
          key={`${page}/${id ?? ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
          style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 96 }}
        >
          {content}
        </motion.div>
        <CallBar />
        <QuickSearch pages={items} />
        <SpecialtyGate />
        <AppointmentReminders />
      </AppShell.Main>

      {mobile && (
        <AppShell.Footer component="nav" className="app-header" style={{ display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)' }}>
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

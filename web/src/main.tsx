import '@fontsource-variable/inter';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/spotlight/styles.css';
import '@mantine/nprogress/styles.css';
import './app.css';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import 'dayjs/locale/tr';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { NavigationProgress } from '@mantine/nprogress';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './session';
import { theme } from './theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <DatesProvider settings={{ locale: 'tr', firstDayOfWeek: 1 }}>
      <ModalsProvider labels={{ confirm: 'Tamam', cancel: 'Vazgeç' }}>
        <Notifications position="top-center" limit={2} autoClose={3000} />
        <NavigationProgress />
        {/* Sistemde "hareketi azalt" açıksa animasyonlar kapanır */}
        <MotionConfig reducedMotion="user">
          <SessionProvider>
            <App />
          </SessionProvider>
        </MotionConfig>
      </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);

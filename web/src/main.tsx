import '@fontsource-variable/inter';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './app.css';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './session';
import { theme } from './theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <ModalsProvider labels={{ confirm: 'Tamam', cancel: 'Vazgeç' }}>
        <Notifications position="top-center" limit={2} autoClose={3000} />
        <SessionProvider>
          <App />
        </SessionProvider>
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);

import { createTheme, type MantineColorsTuple } from '@mantine/core';

// XRE mavisi (logodaki lacivert #24315d'nin koyu zeminde okunan açık tonları); 6. ton ana renk
const xre: MantineColorsTuple = ['#eef1fe', '#d9e0fc', '#b0bff8', '#859cf4', '#6280f1', '#4c6def', '#4063ef', '#3253d5', '#2a4abf', '#1d3fa8'];
// Koyu lacivert-gri zemin: 7 = sayfa, 6 = kart, 4 = çizgi
const dark: MantineColorsTuple = ['#eceef3', '#c6cad6', '#a3a9ba', '#868da1', '#3c4256', '#33384a', '#2a2f40', '#1f2333', '#191c29', '#12141e'];

export const theme = createTheme({
  primaryColor: 'xre',
  primaryShade: 6,
  colors: { xre, dark },
  fontFamily: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'md',
  headings: { fontWeight: '600' },
  components: {
    Button: { defaultProps: { radius: 'xl' } },
    TextInput: { defaultProps: { radius: 'xl' } },
    PasswordInput: { defaultProps: { radius: 'xl' } },
    Select: { defaultProps: { radius: 'xl' } },
  },
});

// Arama yönü renkleri
export const CALL_COLORS = { inbound: 'lime.4', outbound: 'xre.3', missed: 'red.5' } as const;

// Logodaki lacivert (uygulama simgesi, tarayıcı çubuğu)
export const XRE_NAVY = '#24315d';

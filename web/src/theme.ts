import { createTheme, type MantineColorsTuple } from '@mantine/core';

// fibimi'deki turuncu (#f26b21) 6. ton
const orange: MantineColorsTuple = ['#fff1e8', '#ffe0cf', '#fdbf9c', '#fb9c66', '#f87e3a', '#f66f24', '#f26b21', '#d8570f', '#c04b09', '#a73e00'];
// Koyu gri zemin: 7 = sayfa, 6 = kart, 4 = çizgi
const dark: MantineColorsTuple = ['#ececec', '#c9cacd', '#a7aab0', '#8a8d94', '#41444c', '#383b42', '#2e3036', '#24262b', '#1d1f23', '#141518'];

export const theme = createTheme({
  primaryColor: 'orange',
  primaryShade: 6,
  colors: { orange, dark },
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
export const CALL_COLORS = { inbound: 'lime.4', outbound: 'indigo.3', missed: 'red.5' } as const;

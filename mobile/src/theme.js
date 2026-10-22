import { useColorScheme } from 'nativewind';

// className kullanılamayan yerler (ikon rengi, grafik, placeholder) için ham renkler.
// tailwind.config.js'deki renklerle aynı tutun.
const light = {
  text: '#16202E',
  muted: '#667085',
  line: '#E3E7EE',
  card: '#FFFFFF',
  brand: '#1463FF',
  ok: '#0F9D58',
  bad: '#D93025',
  warn: '#B26A00',
};
const dark = { ...light, text: '#E8EDF5', muted: '#94A0B4', line: '#273247', card: '#182131', brand: '#5B8CFF' };

export const providerColors = {
  obilet: '#E4002B',
  enuygun: '#16A34A',
  ucuzabilet: '#F97316',
  skyscanner: '#0770E3',
  tcdd: '#C8102E',
};

export function usePalette() {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? dark : light;
}

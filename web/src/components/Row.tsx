import { ActionIcon, Box, Group, SimpleGrid, Text } from '@mantine/core';
import { IconChevronRight, IconPhone } from '@tabler/icons-react';
import type { ReactNode } from 'react';

// fibimi tarzı liste satırı: ok, renkli başlık, iki sütunlu bilgi, sağda yuvarlak arama düğmesi
export function Row({ href, color, title, details, onCall, callColor = 'lime', callLabel }: {
  href?: string; color?: string; title: ReactNode; details: ReactNode[];
  onCall: () => void; callColor?: string; callLabel: string;
}) {
  const body = (
    <Group wrap="nowrap" align="flex-start" py="md" pr="xs" gap="sm">
      <IconChevronRight size={20} stroke={1.8} color={color ? `var(--mantine-color-${color.replace('.', '-')})` : undefined} style={{ marginTop: 2, flex: 'none' }} />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text c={color} fz="md" tt="uppercase" lineClamp={1}>{title}</Text>
        <SimpleGrid cols={2} spacing="md" verticalSpacing={2} mt={4} maw={560}>
          {details.map((d, i) => <Text key={i} size="sm" c={i < 2 ? undefined : 'dimmed'} truncate>{d}</Text>)}
        </SimpleGrid>
      </Box>
      <ActionIcon
        size={42} radius="xl" color={callColor} variant="filled" aria-label={callLabel} style={{ alignSelf: 'center' }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCall(); }}
      >
        <IconPhone size={20} stroke={2} color="var(--mantine-color-dark-8)" />
      </ActionIcon>
    </Group>
  );
  return href ? <a href={href} className="row-link">{body}</a> : <div className="row-link">{body}</div>;
}

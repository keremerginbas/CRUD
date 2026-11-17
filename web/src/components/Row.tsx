import { ActionIcon, Avatar, Text } from '@mantine/core';
import { IconPhone, type Icon } from '@tabler/icons-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// Liste satırı: avatar (köşesinde yön simgesi), başlık ve alt bilgi, sağda tarih/rozetler ve arama düğmesi
export function Row({ index = 0, href, name, tone, tag: Tag, title, subtitle, meta, onCall, callLabel }: {
  index?: number; href?: string; name: string; tone?: string; tag?: Icon; title: ReactNode; subtitle: ReactNode;
  meta?: ReactNode; onCall: () => void; callLabel: string;
}) {
  const body = (
    <>
      <div className="avatar-wrap">
        <Avatar name={name} color="initials" radius="xl" size={44} />
        {Tag && tone && (
          <span className="avatar-tag" style={{ background: `var(--mantine-color-${tone.replace('.', '-')})` }}><Tag size={12} stroke={2.6} /></span>
        )}
      </div>
      <div className="row-main">
        <Text fw={600} tt="uppercase" truncate c={tone === 'red.5' ? 'red.4' : undefined}>{title}</Text>
        <Text size="sm" c="dimmed" truncate>{subtitle}</Text>
      </div>
      {meta && <div className="row-meta">{meta}</div>}
      <ActionIcon
        size={42} radius="xl" color="lime.5" variant="light" aria-label={callLabel}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCall(); }}
      >
        <IconPhone size={20} stroke={1.9} />
      </ActionIcon>
    </>
  );
  // İlk satırlar sırayla belirir; uzun listede gecikme birikmesin
  const anim = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, delay: Math.min(index, 10) * 0.03 } };
  return href
    ? <motion.a href={href} className="row-card" {...anim}>{body}</motion.a>
    : <motion.div className="row-card" {...anim}>{body}</motion.div>;
}

export function Empty({ icon: I, title, children }: { icon: Icon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><I size={34} stroke={1.5} /></div>
      <Text c="dimmed">{title}</Text>
      {children}
    </div>
  );
}

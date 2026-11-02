import { ActionIcon } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

// fibimi'deki turuncu yuvarlak + düğmesi
export function Fab({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ActionIcon className="fab" size={64} radius="xl" variant="filled" onClick={onClick} aria-label={label}>
      <IconPlus size={30} stroke={2} />
    </ActionIcon>
  );
}

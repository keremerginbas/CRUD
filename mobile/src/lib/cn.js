import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Koşullu sınıfları birleştirir ve çakışan Tailwind sınıflarında sonuncuyu bırakır:
// cn('px-4 bg-brand', active && 'bg-ok') → 'px-4 bg-ok'
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

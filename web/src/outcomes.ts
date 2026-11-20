import type { CallOutcome } from './types';

// Danışmanın görüşme sonrası işaretlediği sonuç (sunucudaki CALL_OUTCOMES ile aynı)
export const OUTCOMES: { value: CallOutcome; label: string; color: string }[] = [
  { value: 'ilgileniyor', label: 'İlgileniyor', color: 'teal' },
  { value: 'randevu', label: 'Randevu alındı', color: 'xre' },
  { value: 'tekrar-ara', label: 'Tekrar aranacak', color: 'yellow' },
  { value: 'ulasilamadi', label: 'Ulaşılamadı', color: 'gray' },
  { value: 'olumsuz', label: 'Olumsuz', color: 'red' },
];
export const outcomeOf = (v?: string | null) => OUTCOMES.find((o) => o.value === v) ?? null;

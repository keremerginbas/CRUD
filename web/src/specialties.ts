export const SPECIALTY_LABELS = { konut: 'Konut', ticari: 'Ticari', arazi: 'Arazi' } as const;
export type Specialty = keyof typeof SPECIALTY_LABELS;
export const SPECIALTY_COLORS: Record<Specialty, string> = { konut: 'cyan', ticari: 'grape', arazi: 'teal' };
export const parseSpecialties = (s: string | null | undefined) => (s ?? '').split(',').filter((x): x is Specialty => x in SPECIALTY_LABELS);

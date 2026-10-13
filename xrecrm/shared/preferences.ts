import { z } from "zod";

/** Stable IDs used by the workspace theme picker and the preferences API. */
export const PREFERENCE_THEMES = [
  "night",
  "light",
  "purple-glass",
  "ocean",
  "forest",
] as const;
export type PreferenceTheme = (typeof PREFERENCE_THEMES)[number];

export const PREFERENCE_BACKGROUNDS = [
  "plain",
  "mesh",
  "aurora",
  "grid",
] as const;
export type PreferenceBackground = (typeof PREFERENCE_BACKGROUNDS)[number];

export const PREFERENCE_DENSITIES = ["compact", "comfortable"] as const;
export type PreferenceDensity = (typeof PREFERENCE_DENSITIES)[number];

export const PREFERENCE_FONT_SIZES = ["small", "normal", "large"] as const;
export type PreferenceFontSize = (typeof PREFERENCE_FONT_SIZES)[number];

/**
 * Preferences are deliberately strict: the server never stores arbitrary
 * client fields, and a user can only update this exact four-value contract.
 */
export const PreferencesSchema = z
  .object({
    theme: z.enum(PREFERENCE_THEMES),
    background: z.enum(PREFERENCE_BACKGROUNDS),
    density: z.enum(PREFERENCE_DENSITIES),
    fontSize: z.enum(PREFERENCE_FONT_SIZES),
  })
  .strict();

export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "night",
  background: "plain",
  density: "compact",
  fontSize: "normal",
};

export const PREFERENCE_THEME_LABELS: Record<PreferenceTheme, string> = {
  night: "XRE Gece",
  light: "Aydınlık",
  "purple-glass": "Mor Cam",
  ocean: "Okyanus",
  forest: "Orman",
};

export const PREFERENCE_BACKGROUND_LABELS: Record<
  PreferenceBackground,
  string
> = {
  plain: "Düz",
  mesh: "Yumuşak ağ",
  aurora: "Aurora",
  grid: "İnce ızgara",
};

export const PREFERENCE_DENSITY_LABELS: Record<PreferenceDensity, string> = {
  compact: "Sıkışık",
  comfortable: "Rahat",
};

export const PREFERENCE_FONT_LABELS: Record<PreferenceFontSize, string> = {
  small: "Küçük",
  normal: "Normal",
  large: "Büyük",
};

/** Record kind used in the shared xre_records store. */
export const USER_PREFERENCE_KIND = "preference" as const;

export function parsePreferences(value: unknown): Preferences {
  return PreferencesSchema.parse(value);
}

export function safePreferences(value: unknown): Preferences {
  const parsed = PreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Palette, X } from "lucide-react";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_BACKGROUND_LABELS,
  PREFERENCE_BACKGROUNDS,
  PREFERENCE_DENSITY_LABELS,
  PREFERENCE_DENSITIES,
  PREFERENCE_FONT_LABELS,
  PREFERENCE_FONT_SIZES,
  PREFERENCE_THEME_LABELS,
  PREFERENCE_THEMES,
  PreferencesSchema,
  type Preferences,
  type PreferenceBackground,
  type PreferenceDensity,
  type PreferenceFontSize,
  type PreferenceTheme,
} from "../../../../shared/preferences";
import { useStore } from "../store";
import "../themes.css";

export const DEMO_PREFERENCES_STORAGE_KEY = "xre-preferences-demo-v1";

type SaveState = "idle" | "saving" | "error";

type ThemeContextValue = {
  /** Duvar kâğıdının saklandığı kimlik (kullanıcıya göre). */
  identity: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  draft: Preferences;
  setTheme: (theme: PreferenceTheme) => void;
  setBackground: (background: PreferenceBackground) => void;
  setDensity: (density: PreferenceDensity) => void;
  setFontSize: (fontSize: PreferenceFontSize) => void;
  apply: () => Promise<void>;
  cancel: () => void;
  saving: boolean;
  error: string | null;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function copyPreferences(value: Preferences): Preferences {
  return { ...value };
}

function readDemoPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(DEMO_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = PreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

// Kullanıcının kendi görseli tarayıcıda saklanır (sunucuya gönderilmez); kimliğe göre ayrılır.
const wallpaperKey = (identity: string) => `xre-wallpaper-v1:${identity}`;
export function readWallpaper(identity: string): string {
  try {
    const value = window.localStorage.getItem(wallpaperKey(identity)) || "";
    return value.startsWith("data:image/") ? value : "";
  } catch {
    return "";
  }
}
function applyWallpaper(dataUrl: string) {
  if (typeof document === "undefined") return;
  if (dataUrl) document.documentElement.style.setProperty("--xre-custom-wallpaper", `url("${dataUrl}")`);
  else document.documentElement.style.removeProperty("--xre-custom-wallpaper");
}
/** Seçilen görseli en çok 1920 piksele küçültüp JPEG olarak saklar; büyük fotoğraflar depolamayı doldurmasın. */
export async function storeWallpaper(identity: string, file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Görsel PNG, JPG veya WEBP olmalı.");
  if (file.size > 15_000_000) throw new Error("Görsel en fazla 15 MB olabilir.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  if (dataUrl.length > 1_400_000) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
  try {
    window.localStorage.setItem(wallpaperKey(identity), dataUrl);
  } catch {
    throw new Error("Görsel tarayıcıya kaydedilemedi (depolama dolu). Daha küçük bir görsel deneyin.");
  }
  applyWallpaper(dataUrl);
  return dataUrl;
}
export function clearWallpaper(identity: string) {
  try {
    window.localStorage.removeItem(wallpaperKey(identity));
  } catch {
    /* depolama kapalı */
  }
  applyWallpaper("");
}

function applyRootPreferences(preferences: Preferences) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.xreTheme = preferences.theme;
  root.dataset.xreBackground = preferences.background;
  root.dataset.xreDensity = preferences.density;
  root.dataset.xreFont = preferences.fontSize;
}

export function useThemePreferences(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value)
    throw new Error("useThemePreferences ThemeProvider içinde kullanılmalı.");
  return value;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { demo, user, request } = useStore();
  const identity = demo
    ? "demo"
    : user?.openId
      ? `user:${String(user.openId)}`
      : "live:anonymous";
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [draft, setDraft] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const identityRef = useRef(identity);
  const saveInFlight = useRef(false);
  const saveToken = useRef(0);

  // Every identity switch clears the previous user's state before starting a
  // read. The generation guard prevents a slower previous GET from crossing
  // users and replacing the current user's theme.
  useEffect(() => {
    const currentGeneration = ++generation.current;
    identityRef.current = identity;
    saveToken.current += 1;
    saveInFlight.current = false;
    setOpen(false);
    setSaveState("idle");
    setError(null);
    setSaved(DEFAULT_PREFERENCES);
    setDraft(DEFAULT_PREFERENCES);
    applyRootPreferences(DEFAULT_PREFERENCES);
    applyWallpaper(readWallpaper(identity));

    if (identity === "demo") {
      const next = readDemoPreferences();
      if (generation.current === currentGeneration) {
        setSaved(copyPreferences(next));
        setDraft(copyPreferences(next));
      }
      return;
    }
    if (!user?.openId) return;

    let active = true;
    void request("/api/preferences")
      .then((value) => {
        if (!active || generation.current !== currentGeneration) return;
        const parsed = PreferencesSchema.safeParse(value);
        const next = parsed.success ? parsed.data : DEFAULT_PREFERENCES;
        setSaved(copyPreferences(next));
        setDraft(copyPreferences(next));
      })
      .catch((reason) => {
        if (!active || generation.current !== currentGeneration) return;
        setSaved(DEFAULT_PREFERENCES);
        setDraft(DEFAULT_PREFERENCES);
        setError(
          reason instanceof Error
            ? reason.message
            : "Görünüm tercihleri okunamadı.",
        );
      });
    return () => {
      active = false;
    };
  }, [identity, request, user?.openId]);

  useEffect(() => {
    applyRootPreferences(draft);
  }, [draft]);

  const update = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setDraft((current) => ({ ...current, [key]: value }));
      setSaveState("idle");
      setError(null);
    },
    [],
  );

  const cancel = useCallback(() => {
    setDraft(copyPreferences(saved));
    setSaveState("idle");
    setError(null);
    setOpen(false);
  }, [saved]);

  const apply = useCallback(async () => {
    if (saveInFlight.current) return;
    const requestIdentity = identityRef.current;
    const requestGeneration = generation.current;
    const next = copyPreferences(draft);
    const requestToken = ++saveToken.current;
    saveInFlight.current = true;
    setSaveState("saving");
    setError(null);
    try {
      if (requestIdentity === "demo") {
        if (typeof window !== "undefined")
          window.localStorage.setItem(
            DEMO_PREFERENCES_STORAGE_KEY,
            JSON.stringify(next),
          );
      } else if (
        user?.openId &&
        requestIdentity === `user:${String(user.openId)}`
      ) {
        const response = await request("/api/preferences", next, "PUT");
        const parsed = PreferencesSchema.safeParse(response);
        if (!parsed.success)
          throw new Error("Sunucu geçersiz görünüm tercihi döndürdü.");
      } else {
        throw new Error("Görünümü kaydetmek için doğrulanmış oturum gerekli.");
      }
      if (
        generation.current !== requestGeneration ||
        identityRef.current !== requestIdentity
      )
        return;
      setSaved(copyPreferences(next));
      setDraft(copyPreferences(next));
      setSaveState("idle");
      setOpen(false);
    } catch (reason) {
      if (
        generation.current !== requestGeneration ||
        identityRef.current !== requestIdentity
      )
        return;
      setSaveState("error");
      setError(
        reason instanceof Error
          ? reason.message
          : "Görünüm tercihleri kaydedilemedi.",
      );
    } finally {
      if (saveToken.current === requestToken) saveInFlight.current = false;
    }
  }, [draft, request, user?.openId]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      identity,
      open,
      setOpen,
      draft,
      setTheme: (theme) => update("theme", theme),
      setBackground: (background) => update("background", background),
      setDensity: (density) => update("density", density),
      setFontSize: (fontSize) => update("fontSize", fontSize),
      apply,
      cancel,
      saving: saveState === "saving",
      error,
    }),
    [apply, cancel, draft, error, identity, open, saveState, update],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <ThemePanel />
    </ThemeContext.Provider>
  );
}

/** Compact topbar control; the text is available to assistive technology. */
export function ThemeButton() {
  const { open, setOpen, cancel } = useThemePreferences();
  return (
    <button
      className={`theme-button icon-button ${open ? "selected" : ""}`}
      type="button"
      aria-label="Görünümü kişiselleştir"
      title="Görünümü kişiselleştir"
      onClick={() => (open ? cancel() : setOpen(true))}
    >
      <Palette size={17} aria-hidden="true" />
    </button>
  );
}

function ThemeChoice({
  value,
  label,
  selected,
  onSelect,
  swatches,
}: {
  value: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  swatches: string[];
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={label}
      aria-checked={selected}
      className={`theme-choice ${selected ? "selected" : ""}`}
      data-choice={value}
      onClick={onSelect}
    >
      <span className="theme-choice-swatches" aria-hidden="true">
        {swatches.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
      </span>
      <span>{label}</span>
      {selected && <Check size={14} aria-hidden="true" />}
    </button>
  );
}

function ChoiceGroup({
  legend,
  values,
  selected,
  labels,
  onSelect,
  className = "",
}: {
  legend: string;
  values: readonly string[];
  selected: string;
  labels: Record<string, string>;
  onSelect: (value: string) => void;
  className?: string;
}) {
  return (
    <fieldset className={`theme-fieldset ${className}`}>
      <legend>{legend}</legend>
      <div className="theme-segmented" role="radiogroup" aria-label={legend}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected === value}
            className={selected === value ? "selected" : ""}
            onClick={() => onSelect(value)}
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ThemePanel() {
  const {
    open,
    setOpen,
    draft,
    setTheme,
    setBackground,
    setDensity,
    setFontSize,
    apply,
    cancel,
    saving,
    error,
    identity,
  } = useThemePreferences();
  const [wallpaper, setWallpaper] = useState("");
  const [wallpaperError, setWallpaperError] = useState("");
  useEffect(() => {
    if (open) setWallpaper(readWallpaper(identity));
  }, [open, identity]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, open, saving]);

  if (!open) return null;
  return (
    <div
      className="theme-panel-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!saving) cancel();
      }}
    >
      <aside
        className="theme-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Görünümü kişiselleştir"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="theme-panel-header">
          <div>
            <span className="eyebrow">KİŞİSEL ÇALIŞMA ALANI</span>
            <h2>Görünümü kişiselleştir</h2>
            <p>Seçimler yalnızca sizin XRE çalışma alanınızı etkiler.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Kapat"
            disabled={saving}
            onClick={cancel}
          >
            <X size={18} />
          </button>
        </header>

        <div className="theme-panel-body">
          <fieldset className="theme-fieldset theme-colors">
            <legend>Renk teması</legend>
            <div
              className="theme-choice-grid"
              role="radiogroup"
              aria-label="Renk teması"
            >
              {PREFERENCE_THEMES.map((theme) => (
                <ThemeChoice
                  key={theme}
                  value={theme}
                  label={PREFERENCE_THEME_LABELS[theme]}
                  selected={draft.theme === theme}
                  onSelect={() => setTheme(theme)}
                  swatches={
                    theme === "night"
                      ? ["#0f1d2e", "#1bb7d9", "#dceaf7"]
                      : theme === "light"
                        ? ["#f5f8fc", "#2d73d5", "#152b46"]
                        : theme === "purple-glass"
                          ? ["#f2edff", "#8456d6", "#2f235c"]
                          : theme === "ocean"
                            ? ["#e6f8fc", "#087f9f", "#123d61"]
                            : ["#e8f6ef", "#19845d", "#12392d"]
                  }
                />
              ))}
            </div>
          </fieldset>

          <div className="theme-panel-row">
            <ChoiceGroup
              legend="Yoğunluk"
              values={PREFERENCE_DENSITIES}
              selected={draft.density}
              labels={PREFERENCE_DENSITY_LABELS}
              onSelect={(value) => setDensity(value as PreferenceDensity)}
            />
            <ChoiceGroup
              legend="Yazı boyutu"
              values={PREFERENCE_FONT_SIZES}
              selected={draft.fontSize}
              labels={PREFERENCE_FONT_LABELS}
              onSelect={(value) => setFontSize(value as PreferenceFontSize)}
            />
          </div>

          <fieldset className="theme-fieldset">
            <legend>Çalışma alanı fonu</legend>
            <div className="theme-wallpapers" role="radiogroup" aria-label="Çalışma alanı fonu">
              {PREFERENCE_BACKGROUNDS.filter((background) => background !== "custom" || wallpaper).map((background) => (
                <button
                  key={background}
                  type="button"
                  role="radio"
                  aria-checked={draft.background === background}
                  className={`wp-${background} ${draft.background === background ? "selected" : ""}`}
                  onClick={() => setBackground(background)}
                >
                  <span aria-hidden="true" style={background === "custom" && wallpaper ? { backgroundImage: `url("${wallpaper}")` } : undefined} />
                  {PREFERENCE_BACKGROUND_LABELS[background]}
                </button>
              ))}
            </div>
            <div className="theme-wallpaper-actions">
              <label className="btn secondary small">
                {wallpaper ? "Görseli değiştir" : "Bilgisayardan görsel ekle"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setWallpaperError("");
                    void storeWallpaper(identity, file)
                      .then((dataUrl) => {
                        setWallpaper(dataUrl);
                        setBackground("custom");
                      })
                      .catch((reason: Error) => setWallpaperError(reason.message));
                  }}
                />
              </label>
              {wallpaper && (
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() => {
                    clearWallpaper(identity);
                    setWallpaper("");
                    if (draft.background === "custom") setBackground("plain");
                  }}
                >
                  Görselimi kaldır
                </button>
              )}
              <small>Kendi görseliniz yalnız bu tarayıcıda saklanır; başka cihazda yeniden eklemeniz gerekir.</small>
            </div>
            {wallpaperError && (
              <p className="theme-error" role="alert">
                {wallpaperError}
              </p>
            )}
          </fieldset>

          {error && (
            <p className="theme-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="theme-panel-footer">
          <button
            className="btn secondary"
            type="button"
            disabled={saving}
            onClick={cancel}
          >
            Vazgeç
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={saving}
            onClick={() => void apply()}
          >
            {saving ? "Kaydediliyor…" : "Uygula"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

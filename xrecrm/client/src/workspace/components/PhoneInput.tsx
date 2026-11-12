import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import "../phone-input.css";

// Bayraklar yalnızca görüntülendiklerinde indirilir (liste açılınca, tembel yükleme).
const flagUrls = import.meta.glob("../../../../node_modules/flag-icons/flags/4x3/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const flagOf = (iso: string) =>
  Object.entries(flagUrls).find(([path]) => path.endsWith(`/${iso.toLowerCase()}.svg`))?.[1] || "";

interface Country {
  iso: CountryCode;
  name: string;
  dial: string;
  search: string;
}
const PINNED: CountryCode[] = ["TR", "DE", "GB", "US", "NL", "FR", "AZ", "RU", "SA", "AE"];
const fold = (value: string) =>
  value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

let cached: Country[] | null = null;
function countries(): Country[] {
  if (cached) return cached;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["tr"], { type: "region" });
  } catch {
    names = null;
  }
  const all = getCountries().map((iso) => {
    const name = names?.of(iso) || iso;
    const dial = getCountryCallingCode(iso);
    return { iso, name, dial, search: `${fold(name)} ${iso.toLowerCase()} +${dial} ${dial}` };
  });
  const rest = all
    .filter((c) => !PINNED.includes(c.iso))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  cached = [...PINNED.map((iso) => all.find((c) => c.iso === iso)!).filter(Boolean), ...rest];
  return cached;
}

/** Kayıtlı değeri (ör. "+90 555 000 00 00" ya da "0555 000 00 00") ülke + yerel numaraya ayırır. */
export function splitPhone(value: string, fallback: CountryCode = "TR"): { iso: CountryCode; national: string } {
  const text = String(value || "").trim();
  if (!text) return { iso: fallback, national: "" };
  const international = text.startsWith("+") || text.startsWith("00");
  if (international) {
    const normalized = text.startsWith("00") ? `+${text.slice(2)}` : text;
    const parsed = parsePhoneNumberFromString(normalized);
    if (parsed?.country) return { iso: parsed.country, national: parsed.nationalNumber };
    const typer = new AsYouType();
    typer.input(normalized);
    const iso = typer.getCountry();
    const code = typer.getCallingCode();
    if (code) {
      const digits = normalized.replace(/\D/g, "").slice(code.length);
      const match = iso || countries().find((c) => c.dial === code)?.iso;
      if (match) return { iso: match, national: digits };
    }
  }
  return { iso: fallback, national: text.replace(/\D/g, "").replace(/^0+/, "") };
}

/** Ülke + yerel rakamlardan kaydedilecek uluslararası biçimi üretir: "+90 555 000 00 00". */
export function joinPhone(iso: CountryCode, national: string): string {
  const digits = national.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  const dial = getCountryCallingCode(iso);
  return new AsYouType().input(`+${dial}${digits}`);
}

function formatNational(iso: CountryCode, national: string): string {
  const digits = national.replace(/\D/g, "");
  if (!digits) return "";
  const dial = getCountryCallingCode(iso);
  const full = new AsYouType().input(`+${dial}${digits}`);
  return full.startsWith(`+${dial}`) ? full.slice(dial.length + 1).trim() : digits;
}

export default function PhoneInput({
  value,
  onChange,
  disabled,
  autoFocus,
  ariaLabel = "Telefon numarası",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const initial = useMemo(() => splitPhone(value), []);
  const [iso, setIso] = useState<CountryCode>(initial.iso);
  const [national, setNational] = useState(initial.national);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);

  // Değer dışarıdan değişirse (form sıfırlama, başka kayıt) alanı yeniden kur.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const next = splitPhone(value, iso);
    setIso(next.iso);
    setNational(next.national);
    lastEmitted.current = value;
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    searchBox.current?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const emit = (nextIso: CountryCode, nextNational: string) => {
    const out = joinPhone(nextIso, nextNational);
    lastEmitted.current = out;
    onChange(out);
  };
  const list = useMemo(() => {
    const q = fold(query.trim());
    return q ? countries().filter((c) => c.search.includes(q)) : countries();
  }, [query]);
  const choose = (country: Country) => {
    setIso(country.iso);
    setOpen(false);
    setQuery("");
    emit(country.iso, national);
    input.current?.focus();
  };
  const type = (text: string) => {
    // Tam numara yapıştırıldıysa (+49…, 0049…) ülkeyi ondan al.
    if (/^\s*(\+|00)/.test(text)) {
      const parsed = splitPhone(text, iso);
      setIso(parsed.iso);
      setNational(parsed.national);
      emit(parsed.iso, parsed.national);
      return;
    }
    const digits = text.replace(/\D/g, "").replace(/^0+/, "").slice(0, 15);
    setNational(digits);
    emit(iso, digits);
  };
  const dial = getCountryCallingCode(iso);
  const current = countries().find((c) => c.iso === iso);

  return (
    <div className={`phone-input ${open ? "open" : ""} ${className}`} ref={root}>
      <div
        className="phone-input-country"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Ülke kodu: ${current?.name || iso} +${dial}`}
        onClick={(event) => {
          event.preventDefault();
          if (!disabled) setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <img src={flagOf(iso)} alt="" width={22} height={16} />
        <ChevronDown size={13} />
        <span>+{dial}</span>
      </div>
      <input
        ref={input}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        aria-label={ariaLabel}
        disabled={disabled}
        autoFocus={autoFocus}
        value={formatNational(iso, national)}
        onChange={(event) => type(event.target.value)}
        placeholder={iso === "TR" ? "555 000 00 00" : "Numara"}
      />
      {open && (
        <div
          className="phone-input-menu"
          onClick={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
              input.current?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive(Math.min(active + 1, list.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(active - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (list[active]) choose(list[active]);
            }
          }}
        >
          <div className="phone-input-search">
            <Search size={14} />
            <input
              ref={searchBox}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              placeholder="Ülke kodu veya adı girin"
              aria-label="Ülke ara"
            />
          </div>
          <ul role="listbox" aria-label="Ülkeler">
            {list.map((country, index) => (
              <li
                key={country.iso}
                role="option"
                aria-selected={country.iso === iso}
                className={`${index === active ? "active" : ""} ${country.iso === iso ? "selected" : ""}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(country);
                }}
                ref={index === active ? (node) => node?.scrollIntoView?.({ block: "nearest" }) : undefined}
              >
                <img src={flagOf(country.iso)} alt="" width={24} height={18} loading="lazy" />
                <span>
                  {country.name} (+{country.dial})
                </span>
                {country.iso === iso && <Check size={15} />}
              </li>
            ))}
            {!list.length && <li className="empty">Eşleşen ülke yok</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

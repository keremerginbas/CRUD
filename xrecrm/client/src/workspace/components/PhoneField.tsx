import { Suspense, lazy } from "react";

// Ülke listesi, bayraklar ve numara biçimlendirme yalnızca bir telefon alanı açıldığında indirilir;
// böylece uygulamanın ilk açılışı küçük kalır.
const PhoneInput = lazy(() => import("./PhoneInput"));

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  className?: string;
};

export default function PhoneField(props: Props) {
  return (
    <Suspense
      fallback={
        <input
          type="tel"
          inputMode="tel"
          aria-label={props.ariaLabel || "Telefon numarası"}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.value)}
        />
      }
    >
      <PhoneInput {...props} />
    </Suspense>
  );
}

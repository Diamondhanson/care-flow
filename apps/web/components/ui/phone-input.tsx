"use client";

/**
 * PhoneInput — a rich international phone field.
 *
 * Wraps `react-phone-number-input` (libphonenumber-js) to provide:
 *   - a country picker (with flag) that sets the dialing code,
 *   - as-you-type formatting in the selected country's national format,
 *   - an E.164 value (e.g. `+237670151973`) emitted via `onChange`.
 *
 * Styled entirely from semantic theme tokens so it adapts to light/dark
 * (per AGENTS.md). Country names are localized EN/FR from the active locale.
 */

import * as React from "react";
import PhoneInputBase, {
  type Country,
  getCountryCallingCode,
} from "react-phone-number-input";
import en from "react-phone-number-input/locale/en.json";
import fr from "react-phone-number-input/locale/fr.json";
import * as CountryFlags from "country-flag-icons/react/3x2";
import { ChevronDown, Globe } from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/components/locale-provider";

/** Flag SVG for an ISO country code, or null when unknown. */
function Flag({ country, label }: { country?: Country; label?: string }) {
  const FlagSvg = country
    ? (CountryFlags as Record<string, React.ComponentType<{ title?: string }>>)[
        country
      ]
    : undefined;
  if (!FlagSvg) {
    return <Globe className="size-4 opacity-70" aria-hidden />;
  }
  return <FlagSvg title={label ?? country} />;
}

/** The national-number text field — must forward a ref for the lib. */
const PhoneTextInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(function PhoneTextInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      data-slot="phone-input-field"
      className={cn(
        "h-full min-w-0 flex-1 rounded-r-lg bg-transparent px-2.5 py-1 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
});

interface CountrySelectProps {
  value?: Country;
  onChange: (value?: Country) => void;
  options: { value?: Country; label: string }[];
  disabled?: boolean;
  readOnly?: boolean;
}

/**
 * Native <select> overlaid on a flag + chevron trigger. The native control
 * gives us free keyboard search and accessibility across both themes.
 */
function CountrySelect({
  value,
  onChange,
  options,
  disabled,
  readOnly,
}: CountrySelectProps) {
  return (
    <div
      data-slot="phone-input-country"
      className="relative flex items-center gap-1 rounded-l-lg border-r border-input pr-1.5 pl-2.5 text-muted-foreground transition-colors focus-within:text-foreground"
    >
      <span className="flex h-3.5 w-5 items-center justify-center overflow-hidden rounded-[2px] [&_svg]:h-full [&_svg]:w-full">
        <Flag country={value} label={value} />
      </span>
      <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      <select
        aria-label="Country"
        value={value ?? ""}
        disabled={disabled || readOnly}
        onChange={(event) =>
          onChange((event.target.value || undefined) as Country | undefined)
        }
        className="absolute inset-0 cursor-pointer text-foreground opacity-0 disabled:cursor-not-allowed"
      >
        {options.map(({ value: country, label }) => (
          <option key={country ?? "ZZ"} value={country ?? ""}>
            {label}
            {country ? ` +${getCountryCallingCode(country)}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface PhoneInputProps {
  id?: string;
  value?: string;
  onChange: (value?: string) => void;
  defaultCountry?: Country;
  placeholder?: string;
  disabled?: boolean;
  /** Render the destructive (error) treatment, e.g. for an invalid number. */
  invalid?: boolean;
  className?: string;
}

export function PhoneInput({
  defaultCountry = "CM",
  className,
  onChange,
  invalid,
  id,
  ...props
}: PhoneInputProps) {
  const { locale } = useT();
  return (
    <PhoneInputBase
      data-slot="phone-input"
      international
      withCountryCallingCode
      defaultCountry={defaultCountry}
      labels={locale === "fr" ? fr : en}
      countrySelectComponent={CountrySelect}
      inputComponent={PhoneTextInput}
      onChange={(value) => onChange(value || undefined)}
      id={id}
      numberInputProps={{
        "aria-invalid": invalid || undefined,
        "aria-describedby": invalid && id ? `${id}-error` : undefined,
      }}
      className={cn(
        "flex h-8 w-full items-stretch rounded-lg border border-input bg-transparent text-base transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-50 md:text-sm dark:bg-input/30",
        invalid &&
          "border-destructive ring-3 ring-destructive/20 focus-within:border-destructive focus-within:ring-destructive/20 dark:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

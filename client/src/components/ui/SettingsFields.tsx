import {
  createContext,
  useContext,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "./Input.js";
import { Select } from "./Select.js";
import { useIsDesktop } from "../../hooks/useIsDesktop.js";

/**
 * Building blocks for small settings forms in overlays (create a game, create
 * a puzzle race, ...). The same fields render two ways:
 *
 *  - desktop (popover): the usual labelled Select / Input fields.
 *  - phone (modal): NO labels, one rounded stack of rows, each with a leading
 *    icon, which is calmer inside a small modal.
 *
 * Put <SettingsSelect>/<SettingsNumber> inside a <SettingsGroup>; the group
 * decides which of the two layouts its children use.
 */

interface GroupContext {
  isDesktop: boolean;
  error?: string;
  hint?: string;
}
const Ctx = createContext<GroupContext>({ isDesktop: true });

export function SettingsGroup({
  error,
  hint,
  children,
}: {
  /** Validation message / helper text for the group's number field. Shown
   *  inside the field on desktop and under the stack on phone. */
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const note = error ?? hint;
  return (
    <Ctx.Provider value={{ isDesktop, error, hint: error ? undefined : hint }}>
      {isDesktop ? (
        <div className="space-y-3">{children}</div>
      ) : (
        <div>
          <div className="divide-y divide-base-300 overflow-hidden rounded-2xl border border-base-300 bg-base-100/60 transition-colors focus-within:border-(--primary)">
            {children}
          </div>
          {note && (
            <p
              className={
                "mt-1.5 px-1 text-xs " +
                (error ? "text-red-500" : "text-base-content/50")
              }
            >
              {note}
            </p>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

// text-base (16px) on purpose: iOS Safari zooms the page on focus for any
// input under 16px.
const STACK_FIELD_CLASSES =
  "h-full w-full bg-transparent text-base text-base-content focus:outline-none";

function StackRow({
  icon,
  chevron,
  children,
}: {
  icon: ReactNode;
  chevron?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="relative flex h-12 items-center gap-3 px-3.5 transition-colors focus-within:bg-(--primary)/5">
      <span className="flex w-4 shrink-0 items-center justify-center text-base-content/40">
        {icon}
      </span>
      {children}
      {chevron && (
        <ChevronDown className="pointer-events-none absolute right-3.5 h-4 w-4 text-base-content/40" />
      )}
    </label>
  );
}

export function SettingsSelect({
  label,
  icon,
  value,
  onChange,
  children,
}: {
  /** Visible label on desktop, aria-label on phone. */
  label: string;
  icon: ReactNode;
  value: string | number;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  /** <option> elements. */
  children: ReactNode;
}) {
  const { isDesktop } = useContext(Ctx);
  if (isDesktop) {
    return (
      <Select label={label} value={value} onChange={onChange}>
        {children}
      </Select>
    );
  }
  return (
    <StackRow icon={icon} chevron>
      <select
        aria-label={label}
        value={value}
        onChange={onChange}
        className={STACK_FIELD_CLASSES + " appearance-none pr-6"}
      >
        {children}
      </select>
    </StackRow>
  );
}

export function SettingsNumber({
  label,
  ariaLabel,
  placeholder,
  icon,
  value,
  onChange,
  min,
  max,
}: {
  /** Visible label on desktop (may include an icon). */
  label: ReactNode;
  ariaLabel: string;
  /** Phone placeholder, since the phone layout has no label. */
  placeholder: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
}) {
  const { isDesktop, error, hint } = useContext(Ctx);
  if (isDesktop) {
    return (
      <Input
        label={label}
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        hint={hint}
      />
    );
  }
  return (
    <StackRow icon={icon}>
      <input
        aria-label={ariaLabel}
        aria-invalid={!!error}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={STACK_FIELD_CLASSES + " placeholder:text-base-content/40"}
      />
    </StackRow>
  );
}

import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Smile } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext.js";
import { Input, type InputProps } from "./Input.js";
import { Spinner } from "./Spinner.js";

// Loaded on first open only.
const EmojiPickerPanel = lazy(() => import("./EmojiPickerPanel.js"));

const PICKER_W = 320;
const PICKER_H = 340;
const GAP = 6;
const MARGIN = 8;

export interface EmojiInputProps extends Omit<InputProps, "onChange" | "value" | "trailingIcon" | "onTrailingIconClick"> {
  value: string;
  /** Called with the new string, whether typed or picked from the keyboard. */
  onChange: (value: string) => void;
}

/** A normal <Input> with a small smiley button inside its right edge that
 *  opens an emoji keyboard. Picked emoji go in at the caret (or replace the
 *  selection) and respect `maxLength`. The picker renders in a portal with
 *  fixed positioning so it isn't clipped by modals, and it's lazy-loaded. */
export function EmojiInput({ value, onChange, maxLength, ...rest }: EmojiInputProps) {
  const { theme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(PICKER_W, window.innerWidth - MARGIN * 2);
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const placeBelow = below >= PICKER_H || below >= above;
    const height = Math.max(240, Math.min(PICKER_H, placeBelow ? below : above));
    const top = placeBelow ? r.bottom + GAP : Math.max(MARGIN, r.top - GAP - height);
    const left = Math.min(Math.max(MARGIN, r.right - width), window.innerWidth - width - MARGIN);
    setPos({ top, left, width, height });
  }, []);

  function toggle() {
    if (open) return setOpen(false);
    place();
    setOpen(true);
  }

  // Close on outside press, Escape, resize, or scrolling anything but the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      // the smiley button toggles itself via its own click handler
      if (wrapRef.current?.contains(t) && t.closest("button")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function insert(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    setOpen(false);
    if (maxLength !== undefined && next.length > maxLength) {
      el?.focus();
      return;
    }
    onChange(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  const trailing: ReactNode = <Smile className="h-4 w-4" />;

  return (
    <div ref={wrapRef} className="w-full">
      <Input
        {...rest}
        ref={inputRef}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        trailingIcon={trailing}
        onTrailingIconClick={toggle}
        trailingIconLabel="Insert emoji"
      />
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, height: pos.height }}
            className="z-[70] overflow-hidden rounded-xl shadow-2xl"
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-base-100">
                  <Spinner />
                </div>
              }
            >
              <EmojiPickerPanel dark={theme === "dark"} width={pos.width} height={pos.height} onPick={insert} />
            </Suspense>
          </div>,
          document.body,
        )}
    </div>
  );
}

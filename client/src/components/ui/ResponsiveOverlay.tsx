import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./Modal.js";
import { Popover } from "./Popover.js";

export interface ResponsiveOverlayProps {
  /** The element that opens the overlay on click — an icon button, a
   *  Button, plain text, whatever. */
  trigger: ReactNode;
  children: ReactNode;
  /** Shown as the Modal's header on phone. The desktop Popover has no
   *  header chrome (it's anchored right next to the trigger, so the
   *  trigger itself already provides that context) — pass a heading
   *  inside `children` too if you want one there as well. */
  title?: string;
  /** Popover-only — ignored on phone, where the Modal is always centered. */
  align?: "start" | "end" | "center";
  side?: "bottom" | "top";
  className?: string;
  icon?: ReactNode;
  /** Viewport width the phone/desktop split happens at. Defaults to
   *  Tailwind's `md` (768px) so this lines up with every other
   *  phone/desktop split in the app (Sidebar, the mobile dock, etc). */
  breakpoint?: number;
  /** Pass both to drive the open state externally (e.g. auto-opening
   *  after some other action); omit to let this manage its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * One trigger, two presentations: a centered Modal on phone, an anchored
 * Popover on desktop. The same "click to reveal a form" interaction reads
 * completely differently at each size — a modal needs room to breathe and
 * a real dismiss target on a small touch screen, while a popover anchored
 * right next to the trigger is faster and less disruptive with a mouse
 * and screen space to spare. Pulled out as a shared component so the
 * dashboard's "create game" form, the players page's per-friend challenge
 * form, and anything else with a compact trigger + a real form behind it
 * (spectator chat, etc.) all get this behavior for free instead of each
 * reimplementing their own breakpoint switch.
 */
export function ResponsiveOverlay({
  trigger,
  children,
  title,
  align = "start",
  side = "bottom",
  className,
  breakpoint = 768,
  open: openProp,
  onOpenChange,
  icon,
}: ResponsiveOverlayProps) {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= breakpoint,
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpoint]);

  if (isDesktop) {
    return (
      <Popover
        trigger={trigger}
        align={align}
        side={side}
        className={className}
        open={open}
        onOpenChange={setOpen}
      >
        {children}
      </Popover>
    );
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        className={className}
        icon={icon}
      >
        {children}
      </Modal>
    </>
  );
}

import { useEffect, useState } from "react";

/** True once the viewport is at least `breakpoint` px wide, false below it,
 *  kept live via a matchMedia listener rather than a resize listener (fires
 *  only when the boolean actually flips, not on every pixel of a drag-resize).
 *  Defaults to Tailwind's `md` (768px) so this lines up with every other
 *  phone/desktop split in the app (Sidebar, the mobile dock, ResponsiveOverlay,
 *  etc). Pulled out of ResponsiveOverlay.tsx so components that need to
 *  actually skip rendering one variant entirely (not just hide it with a
 *  `md:` class) can use the same live breakpoint check — see ChatDrawer.tsx,
 *  which used to mount both the mobile sheet AND the desktop drawer (CSS
 *  hiding whichever didn't apply) and pay for reconciling the full message
 *  list/composer twice on every open. */
export function useIsDesktop(breakpoint = 768): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= breakpoint,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpoint]);

  return isDesktop;
}

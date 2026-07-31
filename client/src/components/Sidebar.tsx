import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, Search, Users, Swords, Trophy, Settings, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.js";
import { cn } from "../lib/cn.js";
import { springSnappy } from "../lib/motion.js";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Passed straight through to NavLink's `end` prop — required for the
   *  Dashboard item since it now lives at "/", which (without `end`) would
   *  otherwise match and light up for every other route too. */
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/find", label: "Find", icon: Search },
  { to: "/friends", label: "Friends", icon: Users },
  { to: "/cage", label: "Cage", icon: Swords },
  { to: "/tournaments", label: "Tournaments", icon: Trophy },
  { to: "/settings", label: "Settings", icon: Settings },
];

// Only this many fit comfortably in the mobile dock before it gets cramped —
// the rest live behind "More".
const MOBILE_PRIMARY_COUNT = 3;
const MOBILE_PRIMARY_ITEMS = NAV_ITEMS.slice(0, MOBILE_PRIMARY_COUNT);
const MOBILE_MORE_ITEMS = NAV_ITEMS.slice(MOBILE_PRIMARY_COUNT);

/**
 * One component, two responsive presentations — a vertical glass rail on
 * desktop (md and up), a fixed glass dock pinned to the bottom of the
 * screen on mobile. Both variants are always in the DOM (Tailwind's
 * `hidden md:flex` / `flex md:hidden` toggles which one actually renders),
 * so each gets its own `layoutId` for the active-item indicator — sharing
 * one between them would make framer-motion try to animate between two
 * differently-shaped layouts the instant the breakpoint changes.
 */
export function Sidebar() {
  const { isAuthed } = useAuth();
  const { pathname } = useLocation();
  if (!isAuthed) return null;

  // The board is the one place screen width is actually precious, so only
  // the game page gets the icon-only collapse-on-hover treatment — every
  // other page keeps the rail fully expanded (labels always visible, no
  // hover behavior at all).
  const collapsible = pathname.startsWith("/game/");

  return (
    <>
      {/* Desktop: vertical rail, flows alongside the page content. On the
       *  game page it's collapsed to icon-only by default and expands on
       *  hover; the width transition is a plain CSS `width` transition (not
       *  framer-motion) — the one spot in this component that isn't
       *  GPU-only, same tradeoff Button's hover:brightness makes: it's a
       *  cheap, hover-only, non-JS-driven transition, not the continuous/
       *  JS-driven kind @/lib/motion.ts's GPU-only rule actually guards
       *  against. */}
      <nav
        aria-label="Primary"
        className={cn(
          "group glass sticky top-20 hidden h-fit shrink-0 flex-col gap-1 self-start overflow-hidden rounded-2xl p-3 md:flex",
          collapsible
            ? "w-16 transition-[width] duration-200 ease-out hover:w-56 hover:shadow-xl"
            : "w-56",
        )}
      >
        {NAV_ITEMS.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            layoutId="sidebar-desktop-active"
            orientation="vertical"
            collapsible={collapsible}
          />
        ))}
      </nav>

      {/* Mobile: fixed bottom dock, overlays the page — main content gets
       *  matching bottom padding in App.tsx so the dock never covers the
       *  last bit of scrollable content. */}
      <MobileDock />
    </>
  );
}

function MobileDock() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const isMoreActive = MOBILE_MORE_ITEMS.some((item) => pathname.startsWith(item.to));

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <>
            {/* Click-away backdrop — invisible, just here to close the dropup. */}
            <motion.div
              className="fixed inset-0 z-30 md:hidden"
              onClick={() => setMoreOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            />
            <motion.div
              className="glass-strong fixed inset-x-3 z-40 flex flex-col gap-1 rounded-2xl p-1.5 md:hidden"
              style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={springSnappy}
            >
              {MOBILE_MORE_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        isActive
                          ? "gradient-brand text-white"
                          : "text-base-content/70 hover:bg-white/10 hover:text-base-content",
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {item.label}
                  </NavLink>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav
        aria-label="Primary"
        className="glass-strong fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl p-1.5 md:hidden"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
      >
        {MOBILE_PRIMARY_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} layoutId="sidebar-mobile-active" orientation="horizontal" />
        ))}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            "relative flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition-colors",
            moreOpen || isMoreActive ? "text-white" : "text-base-content/60 hover:text-base-content",
          )}
        >
          {(moreOpen || isMoreActive) && (
            <motion.span
              layoutId="sidebar-mobile-active"
              transition={springSnappy}
              className="absolute inset-0 -z-10 rounded-xl gradient-brand"
            />
          )}
          <MoreHorizontal className="h-5 w-5 shrink-0" strokeWidth={2} />
          <span className="leading-none">More</span>
        </button>
      </nav>
    </>
  );
}

function SidebarLink({
  item,
  layoutId,
  orientation,
  collapsible = false,
}: {
  item: NavItem;
  layoutId: string;
  orientation: "vertical" | "horizontal";
  collapsible?: boolean;
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 rounded-xl text-sm font-medium transition-colors",
          orientation === "vertical"
            ? cn("px-3 py-2.5", collapsible && "justify-center group-hover:justify-start")
            : "flex-col gap-0.5 px-2.5 py-1.5 text-[11px]",
          isActive ? "text-white" : "text-base-content/60 hover:text-base-content",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={layoutId}
              transition={springSnappy}
              className="absolute inset-0 -z-10 rounded-xl gradient-brand"
            />
          )}
          <Icon className={orientation === "vertical" ? "h-4 w-4 shrink-0" : "h-5 w-5 shrink-0"} strokeWidth={2} />
          <span
            className={
              orientation === "horizontal"
                ? "leading-none"
                : cn(
                    "whitespace-nowrap",
                    // Collapsed rail: the label must take up zero *layout*
                    // width (not just zero opacity) or its real text width
                    // still pushes the flex row around and the icon ends up
                    // looking off-center instead of sitting in the middle of
                    // the icon-only rail. max-w-0 + overflow-hidden collapses
                    // it to nothing; the hover state then grows both the
                    // available width and the opacity together.
                    collapsible &&
                      "max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 group-hover:max-w-[9rem] group-hover:opacity-100 group-hover:delay-75",
                  )
            }
          >
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

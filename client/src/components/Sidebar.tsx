import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { LayoutDashboard, Search, Users, Swords, Trophy, Settings, type LucideIcon } from "lucide-react";
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
      <nav
        aria-label="Primary"
        className="glass-strong fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl p-1.5 md:hidden"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
      >
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} layoutId="sidebar-mobile-active" orientation="horizontal" />
        ))}
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

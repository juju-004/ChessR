import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { LayoutDashboard, Search, Users, Swords, Trophy, Settings, type LucideIcon } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.js";
import { cn } from "../lib/cn.js";
import { springSnappy } from "../lib/motion.js";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
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
  if (!isAuthed) return null;

  return (
    <>
      {/* Desktop: vertical rail, flows alongside the page content. */}
      <nav
        aria-label="Primary"
        className="glass sticky top-20 hidden h-fit w-56 shrink-0 flex-col gap-1 self-start rounded-2xl p-3 md:flex"
      >
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} layoutId="sidebar-desktop-active" orientation="vertical" />
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
}: {
  item: NavItem;
  layoutId: string;
  orientation: "vertical" | "horizontal";
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 rounded-xl text-sm font-medium transition-colors",
          orientation === "vertical" ? "px-3 py-2.5" : "flex-col gap-0.5 px-2.5 py-1.5 text-[11px]",
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
          <span className={orientation === "horizontal" ? "leading-none" : undefined}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

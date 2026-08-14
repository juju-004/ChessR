import { memo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Swords,
  Trophy,
  Settings,
  type LucideIcon,
} from "lucide-react";
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
  { to: "/players", label: "Players", icon: Users },
  { to: "/cage", label: "Cage", icon: Swords },
  { to: "/tournaments", label: "Tournaments", icon: Trophy },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * The desktop-only vertical elevated rail (md and up). The mobile
 * equivalent — MobileDock, exported below — is a fixed bottom tab bar
 * rendered separately in App.tsx, not here.
 */
export const Sidebar = memo(function Sidebar() {
  const { isAuthed } = useAuth();
  const { pathname } = useLocation();
  if (!isAuthed) return null;

  // The board is the one place screen width is actually precious, so only
  // the game page gets the icon-only collapse-on-hover treatment — every
  // other page keeps the rail fully expanded (labels always visible, no
  // hover behavior at all).
  const collapsible = pathname.startsWith("/game/");

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "group elevated z-40 sticky top-20 hidden h-fit shrink-0 flex-col gap-1 self-start overflow-hidden rounded-2xl p-3 md:flex",
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
  );
});

/**
 * The mobile bottom dock — site navigation, phone only. Renders as a
 * full-width tab bar fixed to the bottom of the screen (see `.dock` in
 * index.css). Deliberately hides itself on `/game/:code`: the game page's
 * own action bar (GameActionBarMobile in components/game/GameActionBar.tsx)
 * occupies that same visual slot there instead, sharing the same `.dock`
 * classes so it reads as one dock whose contents change with context
 * rather than two fixed-bottom elements fighting for the same space.
 */
export function MobileDock() {
  const { isAuthed } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!isAuthed) return null;
  if (pathname.startsWith("/game/")) return null;

  return (
    <nav aria-label="Primary" className="docker flex md:hidden">
      {NAV_ITEMS.map((item) => {
        const isActive = item.end
          ? pathname === item.to
          : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <button
            key={item.to}
            type="button"
            onClick={() => navigate(item.to)}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "docker-item docker-item-grow",
              isActive && "docker-item-active",
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
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
          "relative flex flex-1 items-center gap-2.5 rounded-xl text-sm font-medium transition-colors",
          orientation === "vertical"
            ? cn(
                "px-3 py-2.5",
                collapsible && "justify-center group-hover:justify-start",
              )
            : "flex-col gap-0.5 px-2.5 py-1.5 text-[11px]",
          isActive
            ? "text-white"
            : "text-base-content/60 hover:text-base-content",
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
          <Icon
            className={
              orientation === "vertical"
                ? "h-4 w-4 shrink-0"
                : "h-5 w-5 shrink-0"
            }
            strokeWidth={2}
          />
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
                      "max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 group-hover:max-w-36 group-hover:opacity-100 group-hover:delay-75",
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

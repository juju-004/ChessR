import { CageIcon } from "./ui/CageIcon.js";
import { isGamePath, isUnderPath } from "../lib/gamePath.js";
import { memo, useCallback, useEffect, useRef, type CSSProperties } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  Trophy,
  Medal,
  Puzzle,
  CalendarCheck,
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
  /** Passed straight through to NavLink's `end` prop, required for the
   *  Dashboard item since it now lives at "/", which (without `end`) would
   *  otherwise match and light up for every other route too. */
  end?: boolean;
  /** Accent color for the item's icon (chip in the sidebar, icon + active
   *  pill on the phone dock). Exposed as the --item-color custom property. */
  color: string;
  /** Shorter label for the phone dock, where space is tight. */
  dockLabel?: string;
}

const DASHBOARD: NavItem = {
  to: "/",
  label: "Dashboard",
  dockLabel: "Dash",
  icon: LayoutDashboard,
  end: true,
  color: "#60a5fa",
};
const SETTINGS: NavItem = { to: "/settings", label: "Settings", icon: Settings, color: "#94a3b8" };

/** Desktop sidebar sections. Cage, Tournaments and Puzzles are the ways to
 *  play, so they sit together under "Play". */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Play",
    items: [
      { to: "/cage", label: "Cage", icon: CageIcon, color: "#fb7185" },
      { to: "/tournaments", label: "Tournaments", icon: Trophy, color: "#fbbf24" },
      { to: "/puzzles", label: "Puzzles", icon: Puzzle, color: "#34d399" },
    ],
  },
  {
    label: "Explore",
    items: [
      { to: "/players", label: "Players", icon: Users, color: "#38bdf8" },
      { to: "/daily", label: "Daily", icon: CalendarCheck, color: "#fb923c" },
      { to: "/leaderboard", label: "Ranks", icon: Medal, color: "#a78bfa" },
    ],
  },
];

/** Flat list for the mobile dock, in the same order as the sidebar. */
const NAV_ITEMS: NavItem[] = [DASHBOARD, ...NAV_GROUPS.flatMap((g) => g.items), SETTINGS];

/**
 * The desktop-only vertical elevated rail (md and up). The mobile
 * equivalent. MobileDock, exported below, is a fixed bottom tab bar
 * rendered separately in App.tsx, not here.
 */
export const Sidebar = memo(function Sidebar() {
  const { isAuthed } = useAuth();
  const { pathname } = useLocation();
  if (!isAuthed) return null;

  // The board is the one place screen width is actually precious, so only
  // the game page gets the icon-only collapse-on-hover treatment, every
  // other page keeps the rail fully expanded (labels always visible, no
  // hover behavior at all).
  const collapsible = isGamePath(pathname);

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
      <SidebarLink
        item={DASHBOARD}
        layoutId="sidebar-desktop-active"
        orientation="vertical"
        collapsible={collapsible}
      />

      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {/* Expanded: a small section heading. Collapsed icon rail: a thin
              divider instead, until the rail is hovered open. */}
          <p
            className={cn(
              "px-3 pb-0.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-base-content/40",
              collapsible && "hidden group-hover:block",
            )}
          >
            {group.label}
          </p>
          {collapsible && (
            <div className="mx-2 my-2 h-px bg-base-content/10 group-hover:hidden" />
          )}
          {group.items.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              layoutId="sidebar-desktop-active"
              orientation="vertical"
              collapsible={collapsible}
            />
          ))}
        </div>
      ))}

      {/* Settings sits apart at the bottom of the rail. */}
      <div className="mx-2 mb-1 mt-3 h-px bg-base-content/10" />
      <SidebarLink
        item={SETTINGS}
        layoutId="sidebar-desktop-active"
        orientation="vertical"
        collapsible={collapsible}
      />
    </nav>
  );
});

/**
 * The mobile bottom dock, site navigation, phone only. Renders as a
 * full-width tab bar fixed to the bottom of the screen (see `.dock` in
 * index.css). Deliberately hides itself on a game page (`/:code`): the game page's
 * own action bar (GameActionBarMobile in components/game/GameActionBar.tsx)
 * occupies that same visual slot there instead, sharing the same `.dock`
 * classes so it reads as one dock whose contents change with context
 * rather than two fixed-bottom elements fighting for the same space.
 */
export function MobileDock() {
  const { isAuthed } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Soft fade on whichever edge of the strip still has more to scroll to
  // (none at all when it all fits), instead of a hard clipped edge. Written
  // straight to CSS variables so scrolling never re-renders React.
  const updateFades = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.style.setProperty("--fade-l", max > 1 && el.scrollLeft > 2 ? "22px" : "0px");
    el.style.setProperty("--fade-r", max > 1 && el.scrollLeft < max - 2 ? "22px" : "0px");
  }, []);

  // Keep the active tab visible inside the scrolling strip (horizontal only).
  useEffect(() => {
    const el = scrollerRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView({ inline: "center", block: "nearest" });
    updateFades();
  }, [pathname, updateFades]);
  useEffect(() => {
    window.addEventListener("resize", updateFades);
    return () => window.removeEventListener("resize", updateFades);
  }, [updateFades]);
  if (!isAuthed) return null;
  if (isGamePath(pathname)) return null;
  // Same hand-over for a single tournament's page (TournamentActionBarMobile),
  // but not the list or the create form, which keep the normal nav.
  if (/^\/tournaments\/(?!new$)[^/]+\/?$/.test(pathname)) return null;

  const renderItem = (item: NavItem, extra: string) => {
    const isActive = item.end ? pathname === item.to : isUnderPath(pathname, item.to);
    const Icon = item.icon;
    return (
      <button
        key={item.to}
        type="button"
        onClick={() => navigate(item.to)}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        className={cn("docker-item", extra, isActive && "docker-item-active")}
      >
        <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
        <span>{item.dockLabel ?? item.label}</span>
      </button>
    );
  };

  return (
    <nav aria-label="Primary" className="docker flex md:hidden">
      {/* Dashboard is pinned: it sits outside the scroller so it never moves. */}
      {renderItem(NAV_ITEMS[0], "docker-item-pinned")}
      {/* Everything else scrolls sideways when the row is too wide for the phone. */}
      <div ref={scrollerRef} onScroll={updateFades} className="docker-scroll">
        {NAV_ITEMS.slice(1).map((item) => renderItem(item, "docker-item-scroll"))}
      </div>
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
                "px-2 py-1.5",
                collapsible && "justify-center group-hover:justify-start",
              )
            : "flex-col gap-0.5 px-2.5 py-1.5 text-[11px]",
          isActive
            ? "text-white"
            : "text-base-content/60 hover:bg-base-content/5 hover:text-base-content",
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
          {/* Icon chip: tinted with the item's own color at rest, turns
              into a white-on-gradient chip when the link is active. */}
          <span
            style={{ "--item-color": item.color } as CSSProperties}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg transition-colors",
              orientation === "vertical" ? "h-7 w-7" : "h-8 w-8",
              isActive
                ? "bg-white/20 text-white"
                : "bg-(--item-color)/15 text-(--item-color)",
            )}
          >
            <Icon
              className={orientation === "vertical" ? "h-4 w-4" : "h-5 w-5"}
              strokeWidth={2}
            />
          </span>
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

import { GameIcon } from "./ui/GameIcon.js";
import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  Shield,
  Maximize2,
  PartyPopper,
  ShieldAlert,
  Flag,
  Megaphone,
  Wallet,
  CalendarCheck,
} from "lucide-react";
import { pressable } from "@/lib/motion.js";
import { cn } from "@/lib/cn.js";
import { Popover } from "./ui/Popover.js";
import { AcceptDeclineButtons } from "./AcceptDeclineButtons.js";
import { RCoin } from "./ui/index.js";
import { ChallengeSummary } from "./ChallengeSummary.js";
import {
  useNotificationCenter,
  type NotificationItem,
} from "../contexts/NotificationCenterContext.js";
import type { NotificationType } from "../api/notifications.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";

interface NotificationsMenuProps {
  className?: string;
}

const SYSTEM_TYPE_ICON: Record<NotificationType, typeof Megaphone> = {
  welcome: PartyPopper,
  anticheat_freeze: ShieldAlert,
  report_freeze: Flag,
  admin_message: Megaphone,
  tournament_naira_prize: Wallet,
  daily_reward: CalendarCheck,
};

const ICON_TONES = {
  primary: "bg-(--primary)/15 text-(--primary)",
  purple: "bg-purple-500/15 text-purple-400",
  muted: "bg-base-300 text-base-content/70",
} as const;

function IconBadge({
  icon: Icon,
  tone,
}: {
  icon: typeof Megaphone;
  tone: keyof typeof ICON_TONES;
}) {
  return (
    <div
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
        ICON_TONES[tone],
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </div>
  );
}

/** ", 50 R" suffix for a staked challenge; nothing for a free one. */
function WagerNote({ tokens }: { tokens?: number | null }) {
  if (!tokens) return null;
  return (
    <>
      ,{" "}
      <span className="inline-flex gap-0.5">
        {tokens} <RCoin className="translate-y-0.75" size={14} />
      </span>
    </>
  );
}

/** One row in the dropdown: leading icon/avatar + content. Tappable (a
 *  button) when `onClick` is given, otherwise a plain row. */
function MenuRow({
  leading,
  onClick,
  children,
}: {
  leading: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}) {
  const classes =
    "flex w-full items-start gap-2.5 border-b border-base-300/60 px-3 py-2.5 text-left last:border-b-0";
  const body = (
    <>
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(classes, "hover:bg-base-200")}
      >
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

export function NotificationsMenu({ className }: NotificationsMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // The popover is a quick glance, not the full list (that's the Expand
  // button -> /notifications): 3 rows on desktop, 2 on mobile.
  const isDesktop = useIsDesktop();
  const {
    items,
    unreadCount,
    markAllSeen,
    respondToChallengeItem,
    respondToCageInviteItem,
  } = useNotificationCenter();

  const visibleItems = items.slice(0, isDesktop ? 3 : 2);

  function handleSystemItemClick(
    item: Extract<NotificationItem, { kind: "system" }>,
  ) {
    setOpen(false);
    navigate(item.link ?? "/notifications");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) markAllSeen();
      }}
      align="start"
      className={cn(
        "w-72 sm:w-80 max-w-[calc(100vw-2rem)] overflow-hidden",
        className,
      )}
      trigger={
        <motion.button
          aria-label="Notifications"
          aria-expanded={open}
          className="elevated relative flex h-9 w-9 items-center justify-center rounded-full text-base-content/80 hover:text-base-content"
          {...pressable}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-base-200" />
          )}
        </motion.button>
      }
    >
      <div className="-m-1.5">
        <div className="border-b border-base-300 px-3 py-2 text-sm font-semibold text-base-content">
          Notifications
        </div>

        {items.length === 0 && (
          <p className="p-3 text-sm text-base-content/60">
            Challenges and updates from Chessr will show up here.
          </p>
        )}

        <div className="max-h-96 overflow-y-auto">
          {visibleItems.map((item) => {
            if (item.kind === "challenge") {
              return (
                <MenuRow
                  key={`ch-${item.id}`}
                  leading={<IconBadge tone="primary" icon={GameIcon} />}
                >
                  <p className="text-sm text-base-content">
                    <ChallengeSummary
                      username={item.from.username}
                      timeControl={item.timeControl}
                      odds={item.odds}
                      variant={item.variant}
                      wagerTokens={item.wagerTokens}
                      iconSize={11}
                      boldName
                    />
                  </p>
                  <AcceptDeclineButtons
                    variant="pill"
                    onAccept={() => respondToChallengeItem(item.id, true)}
                    onDecline={() => respondToChallengeItem(item.id, false)}
                  />
                </MenuRow>
              );
            }

            if (item.kind === "system") {
              const Icon = SYSTEM_TYPE_ICON[item.type] ?? Megaphone;
              return (
                <MenuRow
                  key={`sys-${item.id}`}
                  onClick={() => handleSystemItemClick(item)}
                  leading={<IconBadge tone="muted" icon={Icon} />}
                >
                  <p className="truncate text-sm font-semibold text-base-content">
                    {item.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-base-content/60">
                    {item.body}
                  </p>
                </MenuRow>
              );
            }

            return (
              <MenuRow
                key={`cage-${item.id}`}
                leading={<IconBadge tone="purple" icon={Shield} />}
              >
                <p className="text-sm text-base-content">
                  <span className="font-semibold">{item.from.username}</span>{" "}
                  <span>
                    challenged you to a {item.legCount}-game cage match
                    {item.wagerMode !== "none" && (
                      <WagerNote tokens={item.wagerTokens} />
                    )}
                  </span>
                </p>
                <AcceptDeclineButtons
                  variant="pill"
                  onAccept={() => respondToCageInviteItem(item.id, true)}
                  onDecline={() => respondToCageInviteItem(item.id, false)}
                />
              </MenuRow>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate("/notifications");
          }}
          className="flex w-full items-center justify-center gap-1.5 border-t border-base-300 py-2 text-xs font-medium text-base-content/60 hover:bg-base-200 hover:text-base-content"
        >
          <Maximize2 className="h-3 w-3" /> Expand
        </button>
      </div>
    </Popover>
  );
}

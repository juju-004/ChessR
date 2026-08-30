import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, Check, X, Swords, Shield } from "lucide-react";
import { pressable } from "@/lib/motion.js";
import { cn } from "@/lib/cn.js";
import { Popover } from "./ui/Popover.js";
import { Avatar, RCoin } from "./ui/index.js";
import { useNotificationCenter } from "../contexts/NotificationCenterContext.js";

interface NotificationsMenuProps {
  className?: string;
}

function timeControlLabel(tc: {
  baseMinutes: number | null;
  incrementSeconds: number;
}): string {
  return tc.baseMinutes === null
    ? "Unlimited"
    : `${tc.baseMinutes}+${tc.incrementSeconds}`;
}

export function NotificationsMenu({ className }: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const {
    items,
    unreadCount,
    markAllSeen,
    respondToFriendRequestItem,
    respondToChallengeItem,
    respondToCageInviteItem,
  } = useNotificationCenter();

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
            Nothing new. Friend requests and challenges will show up here.
          </p>
        )}

        <div className="max-h-96 overflow-y-auto">
          {items.map((item) => {
            if (item.kind === "friend_request") {
              return (
                <div
                  key={`fr-${item.id}`}
                  className="flex items-center gap-2.5 border-b border-base-300/60 px-3 py-2.5 last:border-b-0"
                >
                  <Avatar
                    username={item.from.username}
                    gradient={item.from.avatarGradient}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-base-content">
                      <span className="font-semibold">
                        {item.from.username}
                      </span>{" "}
                      wants to be friends
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() =>
                          respondToFriendRequestItem(item.id, true)
                        }
                        className="flex items-center gap-1 rounded-full bg-(--primary) px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
                      >
                        <Check className="h-3 w-3" /> Accept
                      </button>
                      <button
                        onClick={() =>
                          respondToFriendRequestItem(item.id, false)
                        }
                        className="flex items-center gap-1 rounded-full bg-base-300 px-2.5 py-1 text-xs font-medium text-base-content/70 hover:bg-base-300/70"
                      >
                        <X className="h-3 w-3" /> Decline
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            if (item.kind === "challenge") {
              const wagerNote = item.wagerTokens ? (
                <>
                  ,{" "}
                  <span className="inline-flex gap-0.5">
                    {item.wagerTokens}{" "}
                    <RCoin className="translate-y-0.75" size={14} />
                  </span>
                </>
              ) : (
                ""
              );
              return (
                <div
                  key={`ch-${item.id}`}
                  className="flex items-start gap-2.5 border-b border-base-300/60 px-3 py-2.5 last:border-b-0"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--primary)/15 text-(--primary)">
                    <Swords className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-base-content">
                      <span className="font-semibold">
                        {item.from.username}
                      </span>{" "}
                      challenged you to a game (
                      {timeControlLabel(item.timeControl)}
                      {wagerNote})
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() => respondToChallengeItem(item.id, true)}
                        className="flex items-center gap-1 rounded-full bg-(--primary) px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
                      >
                        <Check className="h-3 w-3" /> Accept
                      </button>
                      <button
                        onClick={() => respondToChallengeItem(item.id, false)}
                        className="flex items-center gap-1 rounded-full bg-base-300 px-2.5 py-1 text-xs font-medium text-base-content/70 hover:bg-base-300/70"
                      >
                        <X className="h-3 w-3" /> Decline
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            const wagerNote =
              item.wagerMode !== "none" && item.wagerTokens ? (
                <>
                  ,{" "}
                  <span className="inline-flex gap-0.5">
                    {item.wagerTokens}{" "}
                    <RCoin className="translate-y-0.75" size={14} />
                  </span>
                </>
              ) : (
                ""
              );
            return (
              <div
                key={`cage-${item.id}`}
                className="flex items-start gap-2.5 border-b border-base-300/60 px-3 py-2.5 last:border-b-0"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-500/15 text-purple-400">
                  <Shield className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-base-content">
                    <span className="font-semibold">{item.from.username}</span>{" "}
                    <span>
                      challenged you to a {item.legCount}-game cage match
                      {wagerNote}
                    </span>
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      onClick={() => respondToCageInviteItem(item.id, true)}
                      className="flex items-center gap-1 rounded-full bg-(--primary) px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
                    >
                      <Check className="h-3 w-3" /> Accept
                    </button>
                    <button
                      onClick={() => respondToCageInviteItem(item.id, false)}
                      className="flex items-center gap-1 rounded-full bg-base-300 px-2.5 py-1 text-xs font-medium text-base-content/70 hover:bg-base-300/70"
                    >
                      <X className="h-3 w-3" /> Decline
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

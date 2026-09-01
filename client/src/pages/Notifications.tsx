import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PartyPopper,
  ShieldAlert,
  Flag,
  Megaphone,
  ChevronLeft,
  ChevronRight,
  Inbox,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
  type NotificationType,
} from "../api/notifications.js";
import { useNotificationCenter } from "../contexts/NotificationCenterContext.js";
import { formatRelativeTime } from "../lib/utils.js";
import { cn } from "../lib/cn.js";
import { Page, Card, Button, Spinner, Stagger, StaggerItem } from "@/components/ui/index.js";

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  welcome: PartyPopper,
  anticheat_freeze: ShieldAlert,
  report_freeze: Flag,
  admin_message: Megaphone,
};

const TYPE_ICON_CLASSES: Record<NotificationType, string> = {
  welcome: "bg-(--primary)/12 text-(--primary)",
  anticheat_freeze: "bg-red-500/12 text-red-400",
  report_freeze: "bg-red-500/12 text-red-400",
  admin_message: "bg-(--primary)/12 text-(--primary)",
};

const PAGE_SIZE = 20;

export function Notifications() {
  const navigate = useNavigate();
  const { markSystemItemSeenLocally } = useNotificationCenter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getNotifications(page, PAGE_SIZE).then((res) => {
      setItems(res.notifications);
      setTotalPages(res.totalPages);
      setUnread(res.unreadCount);
      setLoading(false);
    });
  }, [page]);

  function handleSelect(n: AppNotification) {
    if (!n.read) {
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, read: true } : it)));
      setUnread((c) => Math.max(0, c - 1));
      markSystemItemSeenLocally(n.id); // keeps the bell's badge in sync
      markNotificationRead(n.id).catch(() => {});
    }
    if (n.link) navigate(n.link);
  }

  function handleMarkAllRead() {
    if (unread === 0) return;
    setItems((prev) => prev.map((it) => ({ ...it, read: true })));
    setUnread(0);
    markSystemItemSeenLocally(); // keeps the bell's badge in sync
    markAllNotificationsRead().catch(() => {});
  }

  return (
    <Page
      title="Notifications"
      description="Messages from ChessR about your account."
      back="/"
      bare
      actions={
        unread > 0 ? (
          <Button variant="glass" size="sm" onClick={handleMarkAllRead}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        ) : undefined
      }
    >
      {loading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {!loading && items.length === 0 && (
        <Card variant="solid">
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox className="h-8 w-8 text-base-content/30" />
            <p className="text-sm text-base-content/60">
              Nothing here yet — this is where ChessR will let you know about anything that needs
              your attention.
            </p>
          </div>
        </Card>
      )}

      {!loading && items.length > 0 && (
        <Stagger className="space-y-2">
          {items.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Megaphone;
            return (
              <StaggerItem key={n.id}>
                <Card
                  variant="solid"
                  interactive={!!n.link}
                  onClick={n.link ? () => handleSelect(n) : undefined}
                  className={cn("flex items-start gap-3", !n.read && "ring-1 ring-(--primary)/30")}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      TYPE_ICON_CLASSES[n.type],
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-base-content">
                      {n.title}
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--primary)" />}
                    </p>
                    <p className="mt-0.5 text-sm text-base-content/70">{n.body}</p>
                    <p className="mt-1 text-xs text-base-content/50">
                      {formatRelativeTime(n.createdAt)}
                    </p>
                  </div>

                  {!n.read && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(n);
                      }}
                      className="shrink-0 self-start rounded-md px-2 py-1 text-xs font-medium text-(--primary) hover:bg-(--primary)/10"
                    >
                      Mark read
                    </button>
                  )}
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button variant="glass" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-base-content/60">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="glass"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </Page>
  );
}

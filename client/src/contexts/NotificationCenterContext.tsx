import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext.js";
import { useSocket } from "./SocketContext.js";
import { useOnOwnGamePageRef } from "../hooks/useOnOwnGamePageRef.js";
import {
  getNotifications,
  markAllNotificationsRead,
  type AppNotification,
  type NotificationType,
} from "../api/notifications.js";

interface ChallengeItem {
  kind: "challenge";
  id: string;
  from: { id: string; username: string };
  timeControl: { baseMinutes: number | null; incrementSeconds: number };
  /** The reader's own clock when it differs from the challenger's. */
  odds?: { baseMinutes: number | null; incrementSeconds: number } | null;
  variant?: string;
  wagerTokens?: number;
  /** Ms timestamp after which the server no longer has this challenge. */
  expiresAt?: number;
  seen: boolean;
}

interface CageInviteItem {
  kind: "cage_invite";
  id: string;
  from: { id: string; username: string };
  legCount: number;
  wagerMode: string;
  wagerTokens?: number;
  seen: boolean;
}

// ChessR's own persisted messages to the account (welcome, anti-cheat/
// report freeze alerts, admin broadcasts, ...), see models/Notification.ts
// server-side. Unlike the other three kinds here, these are backed by a
// real DB record with a durable read/unread state, not just "seen in this
// session", and they're the one kind with no accept/decline actions, just
// tap-to-open. "seen" here mirrors `read` from the API, kept in sync via
// markAllNotificationsRead below rather than being purely a local flag.
interface SystemNotificationItem {
  kind: "system";
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  seen: boolean;
}

export type NotificationItem =
  | ChallengeItem
  | CageInviteItem
  | SystemNotificationItem;

interface NotificationCenterValue {
  items: NotificationItem[];
  unreadCount: number;
  markAllSeen: () => void;
  respondToChallengeItem: (id: string, accept: boolean) => void;
  respondToCageInviteItem: (id: string, accept: boolean) => void;
  /** id omitted marks every system item seen locally. */
  markSystemItemSeenLocally: (id?: string) => void;
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null);

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  const socket = useSocket();
  const [items, setItems] = useState<NotificationItem[]>([]);
  // Same ref GlobalListeners' toast decision reads, on purpose: a
  // challenge should show as a toast OR a notification-bell item, never
  // both, and the only way to guarantee that is having both places check
  // the exact same source at the exact same moment rather than each
  // keeping their own copy of "is the user mid-game" that could drift out
  // of sync with the other.
  const onOwnGamePageRef = useOnOwnGamePageRef();

  // System notifications are the only persisted kind, so they're the only
  // ones seeded from the server on load. Challenges and cage invites are
  // Redis-backed with a short TTL by design (see challengeSocket.ts /
  // cageMatchSocket.ts), there's nothing to backfill for those, they only
  // ever enter this list live, the same way the existing toast
  // notifications in GlobalListeners do.
  useEffect(() => {
    if (!isAuthed) {
      setItems([]);
      return;
    }

    // System notifications are the actual source of truth here (there's no
    // separate full-list page these merely mirror, /notifications reads
    // from the same API), so this seeds whatever's unread plus a little
    // recent read history, not just a pending queue.
    getNotifications(1, 20)
      .then(({ notifications }) => {
        setItems((prev) => [
          ...notifications.map(
            (n: AppNotification): SystemNotificationItem => ({
              kind: "system",
              id: n.id,
              type: n.type,
              title: n.title,
              body: n.body,
              link: n.link,
              seen: n.read,
            }),
          ),
          ...prev,
        ]);
      })
      .catch(() => {
        /* Best-effort: the /notifications page is still the full list. */
      });
  }, [isAuthed]);

  useEffect(() => {
    if (!socket) return;

    function onChallengeReceived(payload: {
      challengeId: string;
      from: { id: string; username: string };
      timeControl: { baseMinutes: number | null; incrementSeconds: number };
      odds?: { baseMinutes: number | null; incrementSeconds: number } | null;
      variant?: string;
      wagerTokens?: number;
      expiresInSeconds?: number;
      /** Waited for this player (sent while they were offline). */
      queued?: boolean;
    }) {
      // Mirror image of GlobalListeners' toast suppression: outside the
      // game page this already showed as a toast, so it doesn't need to
      // also show up here, that was the double-up bug (bell dot AND
      // toast for the same challenge). Only add it here when the toast
      // itself was suppressed (mid-game), so it's not lost entirely.
      // The exception is a queued challenge (sent while they were offline):
      // its toast fades after a minute but the challenge itself waits much
      // longer, so it always gets a bell item too.
      if (!onOwnGamePageRef.current && !payload.queued) return;
      setItems((prev) => {
        // A reconnect replays everything still waiting; don't add it twice.
        if (prev.some((i) => i.kind === "challenge" && i.id === payload.challengeId)) return prev;
        return [
          {
            kind: "challenge",
            id: payload.challengeId,
            from: payload.from,
            timeControl: payload.timeControl,
            odds: payload.odds,
            variant: payload.variant,
            wagerTokens: payload.wagerTokens,
            expiresAt: payload.expiresInSeconds
              ? Date.now() + payload.expiresInSeconds * 1000
              : undefined,
            seen: false,
          },
          ...prev,
        ];
      });
    }

    function removeChallenge(challengeId?: string) {
      if (!challengeId) return;
      setItems((prev) => prev.filter((i) => !(i.kind === "challenge" && i.id === challengeId)));
    }

    function onCageReceived(payload: {
      inviteId: string;
      from: { id: string; username: string };
      legs: unknown[];
      wagerMode: string;
      wagerTokens?: number;
    }) {
      setItems((prev) => [
        {
          kind: "cage_invite",
          id: payload.inviteId,
          from: payload.from,
          legCount: payload.legs.length,
          wagerMode: payload.wagerMode,
          wagerTokens: payload.wagerTokens,
          seen: false,
        },
        ...prev,
      ]);
    }

    // See notification.service.ts's createNotification on the server,
    // pushed to this user's own socket room the same way every other
    // event here is addressed.
    function onSystemNotification(payload: {
      id: string;
      type: NotificationType;
      title: string;
      body: string;
      link?: string;
    }) {
      setItems((prev) => [
        {
          kind: "system",
          id: payload.id,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          link: payload.link,
          seen: false,
        },
        ...prev,
      ]);
    }

    function removeCageInvite(inviteId?: string) {
      if (!inviteId) return;
      setItems((prev) => prev.filter((i) => !(i.kind === "cage_invite" && i.id === inviteId)));
    }

    function onChallengeResolved(payload?: { challengeId?: string }) {
      removeChallenge(payload?.challengeId);
    }
    function onChallengeCancelled(payload?: { challengeId?: string }) {
      removeChallenge(payload?.challengeId);
    }
    function onCageResolved() {
      removeCageInvite(undefined);
    }
    function onCageCancelled(payload?: { inviteId?: string }) {
      removeCageInvite(payload?.inviteId);
    }

    socket.on("challenge:received", onChallengeReceived);
    // Any of these three mean the challenge is no longer actionable,
    // whichever side caused it (including this person having just
    // responded from elsewhere, e.g. the GlobalListeners toast, this is
    // just cleanup for the notification-center copy of the same item).
    // Named handlers, not inline closures, matter here specifically
    // because this socket instance is shared app-wide (see SocketContext):
    // socket.off(event) with no handler reference strips every listener
    // for that event, GlobalListeners' own navigation handler for
    // challenge:accepted included, not just this one.
    socket.on("challenge:accepted", onChallengeResolved);
    socket.on("challenge:declined", onChallengeResolved);
    socket.on("challenge:cancelled", onChallengeCancelled);
    // Answered from another place (the toast, or another tab of this account).
    socket.on("challenge:resolved", onChallengeResolved);
    socket.on("cage:accepted", onCageResolved);
    socket.on("cage:declined", onCageResolved);
    socket.on("cage:cancelled", onCageCancelled);
    socket.on("cage:received", onCageReceived);
    socket.on("notification:new", onSystemNotification);

    return () => {
      socket.off("challenge:received", onChallengeReceived);
      socket.off("challenge:accepted", onChallengeResolved);
      socket.off("challenge:declined", onChallengeResolved);
      socket.off("challenge:cancelled", onChallengeCancelled);
      socket.off("challenge:resolved", onChallengeResolved);
      socket.off("cage:accepted", onCageResolved);
      socket.off("cage:declined", onCageResolved);
      socket.off("cage:cancelled", onCageCancelled);
      socket.off("cage:received", onCageReceived);
      socket.off("notification:new", onSystemNotification);
    };
  }, [socket]);

  const markAllSeen = useCallback(() => {
    setItems((prev) => {
      const hasUnseenSystem = prev.some((i) => i.kind === "system" && !i.seen);
      if (hasUnseenSystem) {
        // Best-effort, mirrors the read state on /notifications too (see
        // notification.service.ts), not just a local flag the way
        // "seen" is for the other three kinds here.
        markAllNotificationsRead().catch(() => {});
      }
      return prev.map((i) => (i.seen ? i : { ...i, seen: true }));
    });
  }, []);

  const respondToChallengeItem = useCallback(
    (id: string, accept: boolean) => {
      setItems((prev) => prev.filter((i) => !(i.kind === "challenge" && i.id === id)));
      socket?.emit("challenge:respond", { challengeId: id, accept });
    },
    [socket],
  );

  const respondToCageInviteItem = useCallback(
    (id: string, accept: boolean) => {
      setItems((prev) => prev.filter((i) => !(i.kind === "cage_invite" && i.id === id)));
      socket?.emit("cage:respond", { inviteId: id, accept });
    },
    [socket],
  );

  // Local-only flip, no API call, for callers (the /notifications page)
  // that already made their own markNotificationRead/markAllNotificationsRead
  // request and just need the bell's copy of that same item to catch up
  // so its badge count doesn't disagree with what the page just showed.
  const markSystemItemSeenLocally = useCallback((id?: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.kind === "system" && !i.seen && (id === undefined || i.id === id)
          ? { ...i, seen: true }
          : i,
      ),
    );
  }, []);

  // Challenges whose server-side lifetime has run out are no longer
  // answerable, so they drop out of the list instead of erroring on tap.
  const liveItems = useMemo(
    () =>
      items.filter(
        (i) => i.kind !== "challenge" || !i.expiresAt || i.expiresAt > Date.now(),
      ),
    [items],
  );

  const unreadCount = useMemo(() => liveItems.filter((i) => !i.seen).length, [liveItems]);

  const value = useMemo<NotificationCenterValue>(
    () => ({
      items: liveItems,
      unreadCount,
      markAllSeen,
      respondToChallengeItem,
      respondToCageInviteItem,
      markSystemItemSeenLocally,
    }),
    [
      liveItems,
      unreadCount,
      markAllSeen,
      respondToChallengeItem,
      respondToCageInviteItem,
      markSystemItemSeenLocally,
    ],
  );

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter(): NotificationCenterValue {
  const ctx = useContext(NotificationCenterContext);
  if (!ctx) throw new Error("useNotificationCenter must be used within NotificationCenterProvider");
  return ctx;
}

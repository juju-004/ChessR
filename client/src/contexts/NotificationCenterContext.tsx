import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext.js";
import { useSocket } from "./SocketContext.js";
import { useOnOwnGamePageRef } from "../hooks/useOnOwnGamePageRef.js";
import {
  listIncomingRequests,
  respondToFriendRequest,
  type IncomingRequest,
} from "../api/friends.js";

interface FriendRequestItem {
  kind: "friend_request";
  id: string;
  from: {
    id: string;
    username: string;
    avatarGradient?: string | null;
    ratingCategory: string | null;
  };
  seen: boolean;
}

interface ChallengeItem {
  kind: "challenge";
  id: string;
  from: { id: string; username: string };
  timeControl: { baseMinutes: number | null; incrementSeconds: number };
  wagerTokens?: number;
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

export type NotificationItem = FriendRequestItem | ChallengeItem | CageInviteItem;

interface NotificationCenterValue {
  items: NotificationItem[];
  unreadCount: number;
  markAllSeen: () => void;
  respondToFriendRequestItem: (id: string, accept: boolean) => void;
  respondToChallengeItem: (id: string, accept: boolean) => void;
  respondToCageInviteItem: (id: string, accept: boolean) => void;
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

  // Friend requests are the one kind of these three that's actually
  // persisted (see FriendRequest model / listIncomingRequests), so they're
  // the only ones seeded from the server on load, a request sent while
  // this person was offline still shows up next time they open the app.
  // Challenges and cage invites are Redis-backed with a short TTL by
  // design (see challengeSocket.ts / cageMatchSocket.ts), there's nothing
  // to backfill for those, they only ever enter this list live, the same
  // way the existing toast notifications in GlobalListeners do.
  useEffect(() => {
    if (!isAuthed) {
      setItems([]);
      return;
    }
    listIncomingRequests()
      .then(({ requests }) => {
        setItems((prev) => [
          ...requests.map(
            (r: IncomingRequest): FriendRequestItem => ({
              kind: "friend_request",
              id: r._id,
              from: {
                id: r.from._id,
                username: r.from.username,
                avatarGradient: r.from.avatarGradient,
                ratingCategory: r.from.ratingCategory,
              },
              seen: true,
            }),
          ),
          ...prev,
        ]);
      })
      .catch(() => {
        /* Not critical, the Players page's own request list is still the
           source of truth either way, this just backs the bell. */
      });
  }, [isAuthed]);

  useEffect(() => {
    if (!socket) return;

    function onFriendRequestReceived(payload: {
      requestId: string;
      from: {
        id: string;
        username: string;
        avatarGradient?: string | null;
        ratingCategory: string | null;
      };
    }) {
      setItems((prev) => [
        {
          kind: "friend_request",
          id: payload.requestId,
          from: {
            id: payload.from.id,
            username: payload.from.username,
            avatarGradient: payload.from.avatarGradient,
            ratingCategory: payload.from.ratingCategory,
          },
          seen: false,
        },
        ...prev,
      ]);
    }

    function onChallengeReceived(payload: {
      challengeId: string;
      from: { id: string; username: string };
      timeControl: { baseMinutes: number | null; incrementSeconds: number };
      wagerTokens?: number;
    }) {
      // Mirror image of GlobalListeners' toast suppression: outside the
      // game page this already showed as a toast, so it doesn't need to
      // also show up here, that was the double-up bug (bell dot AND
      // toast for the same challenge). Only add it here when the toast
      // itself was suppressed (mid-game), so it's not lost entirely.
      if (!onOwnGamePageRef.current) return;
      setItems((prev) => [
        {
          kind: "challenge",
          id: payload.challengeId,
          from: payload.from,
          timeControl: payload.timeControl,
          wagerTokens: payload.wagerTokens,
          seen: false,
        },
        ...prev,
      ]);
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

    function removeCageInvite(inviteId?: string) {
      if (!inviteId) return;
      setItems((prev) => prev.filter((i) => !(i.kind === "cage_invite" && i.id === inviteId)));
    }

    function onChallengeResolved() {
      removeChallenge(undefined);
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

    socket.on("friend:request_received", onFriendRequestReceived);
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
    socket.on("cage:accepted", onCageResolved);
    socket.on("cage:declined", onCageResolved);
    socket.on("cage:cancelled", onCageCancelled);
    socket.on("cage:received", onCageReceived);

    return () => {
      socket.off("friend:request_received", onFriendRequestReceived);
      socket.off("challenge:received", onChallengeReceived);
      socket.off("challenge:accepted", onChallengeResolved);
      socket.off("challenge:declined", onChallengeResolved);
      socket.off("challenge:cancelled", onChallengeCancelled);
      socket.off("cage:accepted", onCageResolved);
      socket.off("cage:declined", onCageResolved);
      socket.off("cage:cancelled", onCageCancelled);
      socket.off("cage:received", onCageReceived);
    };
  }, [socket]);

  const markAllSeen = useCallback(() => {
    setItems((prev) => prev.map((i) => (i.seen ? i : { ...i, seen: true })));
  }, []);

  const respondToFriendRequestItem = useCallback((id: string, accept: boolean) => {
    setItems((prev) => prev.filter((i) => !(i.kind === "friend_request" && i.id === id)));
    respondToFriendRequest(id, accept).catch(() => {
      /* Best-effort, same as the equivalent flow on the Players page. */
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

  const unreadCount = items.filter((i) => !i.seen).length;

  return (
    <NotificationCenterContext.Provider
      value={{
        items,
        unreadCount,
        markAllSeen,
        respondToFriendRequestItem,
        respondToChallengeItem,
        respondToCageInviteItem,
      }}
    >
      {children}
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter(): NotificationCenterValue {
  const ctx = useContext(NotificationCenterContext);
  if (!ctx) throw new Error("useNotificationCenter must be used within NotificationCenterProvider");
  return ctx;
}

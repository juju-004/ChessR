import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Swords, Eye, UserCircle2 } from "lucide-react";
import {
  listFriends,
  listIncomingRequests,
  respondToFriendRequest,
  type Friend,
  type IncomingRequest,
} from "../api/friends.js";
import { useSocket } from "../contexts/SocketContext.js";
import { TIME_CONTROLS } from "../timeControls.js";
import { Page } from "@/components/ui/Page.js";
import { Card } from "@/components/ui/Card.js";
import { Select } from "@/components/ui/Select.js";
import { Input } from "@/components/ui/Input.js";
import { Button } from "@/components/ui/Button.js";

type SortMode = "alphabetical" | "online";

export function Friends() {
  const socket = useSocket();
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("online");
  const [tcIndex, setTcIndex] = useState(2);
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [wagerInput, setWagerInput] = useState("0");
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const refreshRequests = useCallback(() => {
    listIncomingRequests().then((res) => setRequests(res.requests));
  }, []);

  const refreshFriends = useCallback(() => {
    listFriends().then((res) => setFriends(res.friends));
  }, []);

  useEffect(() => {
    refreshRequests();
    refreshFriends();
  }, [refreshRequests, refreshFriends]);

  useEffect(() => {
    if (!socket) return;

    function onRequestReceived() {
      refreshRequests();
    }
    function onPresence() {
      refreshFriends();
    }
    function onSent() {
      setStatus({
        message: "Challenge sent — waiting for a response…",
        isError: false,
      });
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }

    socket.on("friend:request_received", onRequestReceived);
    socket.on("friend:presence", onPresence);
    socket.on("challenge:sent", onSent);
    socket.on("challenge:error", onError);

    return () => {
      socket.off("friend:request_received", onRequestReceived);
      socket.off("friend:presence", onPresence);
      socket.off("challenge:sent", onSent);
      socket.off("challenge:error", onError);
    };
  }, [socket, refreshFriends]);

  async function handleAccept(requestId: string) {
    await respondToFriendRequest(requestId, true);
    refreshRequests();
    refreshFriends();
  }

  async function handleDecline(requestId: string) {
    await respondToFriendRequest(requestId, false);
    refreshRequests();
  }

  function handleChallenge(friendId: string) {
    if (!socket) return;
    const tc = TIME_CONTROLS[tcIndex];
    const wagerTokens = Math.max(0, Math.floor(Number(wagerInput) || 0));
    socket.emit("challenge:send", {
      toUserId: friendId,
      baseMinutes: tc.baseMinutes,
      incrementSeconds: tc.incrementSeconds,
      variant,
      wagerTokens,
    });
    const wagerNote = wagerTokens > 0 ? `, ${wagerTokens} R wager` : "";
    setStatus({
      message: `Challenge sent (${tc.label}${variant === "chess960" ? ", Chess960" : ""}${wagerNote}) — waiting for a response…`,
      isError: false,
    });
  }

  // Search matches on username substring (case-insensitive); sort mode
  // "online" groups online friends first (alphabetical within each group)
  // so the people you can actually challenge right now surface without
  // hunting through a long offline list — "alphabetical" ignores online
  // status entirely for a straight a-z list.
  const visibleFriends = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? friends.filter((f) => f.username.toLowerCase().includes(query))
      : friends;
    return [...filtered].sort((a, b) => {
      if (sortMode === "online" && a.online !== b.online) {
        return a.online ? -1 : 1;
      }
      return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
    });
  }, [friends, search, sortMode]);

  return (
    <Page title="Friends" description="View and challenge your friends.">
      <div className="space-y-4">
        {status && (
          <p
            className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
          >
            {status.message}
          </p>
        )}

        <Card variant="solid">
          <h1 className="mb-2 text-lg font-semibold text-base-content">
            Friend requests
          </h1>
          {requests.length === 0 && (
            <p className="text-sm text-base-content/60">No pending requests.</p>
          )}
          {requests.map((r) => (
            <div
              key={r._id}
              className="flex items-center justify-between border-b border-base-300 py-2 last:border-none"
            >
              <span className="text-sm text-base-content">
                {r.from.username}
              </span>
              <span className="flex gap-2">
                <button
                  onClick={() => handleAccept(r._id)}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleDecline(r._id)}
                  className="rounded-md bg-base-300 px-3 py-1.5 text-sm font-semibold text-base-content hover:bg-base-300"
                >
                  Decline
                </button>
              </span>
            </div>
          ))}
        </Card>

        <Card variant="solid" className="w-full">
          <h1 className="mb-6 text-lg font-semibold text-base-content">
            Friends
          </h1>

          <Select
            label="Time control"
            value={tcIndex}
            className="mb-3.5"
            onChange={(e) => setTcIndex(Number(e.target.value))}
          >
            {TIME_CONTROLS.map((tc, i) => (
              <option key={tc.label} value={i}>
                {tc.label}
              </option>
            ))}
          </Select>

          <Select
            label="Variant"
            className="mb-3.5"
            value={variant}
            onChange={(e) =>
              setVariant(e.target.value as "standard" | "chess960")
            }
          >
            <option value="standard">Standard</option>
            <option value="chess960">Chess960 (Fischer Random)</option>
          </Select>

          <Input
            label="R Coin wager (per player)"
            type="number"
            className="mb-3.5"
            min={0}
            step={1}
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
            placeholder="0 for a free game"
          />

          <div className="mb-3.5 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a friend by username…"
                leadingIcon={<Search className="h-4 w-4" />}
              />
            </div>
            <div className="sm:w-44">
              <Select
                label="Sort by"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="online">Online first</option>
                <option value="alphabetical">Alphabetical</option>
              </Select>
            </div>
          </div>

          {friends.length === 0 && (
            <p className="text-sm text-base-content/60">
              No friends yet. Find players and add some!
            </p>
          )}
          {friends.length > 0 && visibleFriends.length === 0 && (
            <p className="text-sm text-base-content/60">
              No friends match "{search}".
            </p>
          )}
          {visibleFriends.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 py-2 last:border-none"
            >
              <span className="flex items-center gap-2 text-sm text-base-content">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${f.online ? "bg-green-500" : "bg-base-300"}`}
                />
                {f.username}
              </span>
              <span className="flex flex-wrap gap-2">
                <Link to={`/profile/${f.username}`}>
                  <Button variant="glass" size="sm">
                    <UserCircle2 className="h-4 w-4" /> Profile
                  </Button>
                </Link>
                {f.activeGameCode ? (
                  <Link to={`/game/${f.activeGameCode}`}>
                    <Button variant="glass" size="sm">
                      <Eye className="h-4 w-4 text-green-500" /> Watch
                    </Button>
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleChallenge(f.id)}
                    disabled={!f.online}
                  >
                    Challenge
                  </Button>
                )}
                <Link to={`/cage?challenge=${f.id}`}>
                  <Button variant="glass" size="sm">
                    <Swords className="h-4 w-4" /> Cage match
                  </Button>
                </Link>
              </span>
            </div>
          ))}
        </Card>
      </div>
    </Page>
  );
}

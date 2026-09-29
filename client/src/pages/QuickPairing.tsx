import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, X } from "lucide-react";
import { useSocket } from "../contexts/SocketContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useQuickPairingSegments } from "../hooks/useQuickPairingSegments.js";
import { cn } from "@/lib/cn.js";
import { RatingBadge } from "../components/RatingBadge.js";
import {
  Page,
  Card,
  CardContent,
  Button,
  Badge,
  Spinner,
  TimeControlIcon,
} from "../components/ui/index.js";

interface MatchedPayload {
  gameId: string;
  joinCode: string;
  segmentId: string;
}

/** Lichess-style quick pairing: pick one of the lobbies, press Play, and
 *  the server pairs you with someone in the same lobby whose rating is
 *  close to yours (the window widens the longer you wait, see
 *  quickPairing.service.ts). Lobby sizes are live, pushed over the socket
 *  while this page is open. */
export function QuickPairing() {
  const socket = useSocket();
  const navigate = useNavigate();
  const { user } = useAuth();
  const segments = useQuickPairingSegments();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [waitedSeconds, setWaitedSeconds] = useState(0);
  const [error, setError] = useState("");

  // Lets the unmount cleanup know whether to pull us out of the queue
  // without re-running the whole effect every time searching flips.
  const searchingRef = useRef(false);
  searchingRef.current = searchingId !== null;

  useEffect(() => {
    if (!socket) return;
    const s = socket;

    function watch() {
      s.emit("quickPairing:watch");
    }
    function onCounts(p: { counts: Record<string, number> }) {
      setCounts(p.counts);
    }
    function onJoined(p: { segmentId: string }) {
      setSearchingId(p.segmentId);
      setStarting(false);
      setError("");
    }
    function onLeft() {
      setSearchingId(null);
      setStarting(false);
    }
    function onMatched(p: MatchedPayload) {
      setSearchingId(null);
      navigate(`/game/${p.joinCode}`);
    }
    function onError(p: { message: string }) {
      setError(p.message);
      setStarting(false);
    }

    s.on("connect", watch);
    s.on("quickPairing:counts", onCounts);
    s.on("quickPairing:joined", onJoined);
    s.on("quickPairing:left", onLeft);
    s.on("quickPairing:matched", onMatched);
    s.on("quickPairing:error", onError);
    if (s.connected) watch();

    return () => {
      s.off("connect", watch);
      s.off("quickPairing:counts", onCounts);
      s.off("quickPairing:joined", onJoined);
      s.off("quickPairing:left", onLeft);
      s.off("quickPairing:matched", onMatched);
      s.off("quickPairing:error", onError);
      s.emit("quickPairing:unwatch");
      // Leaving the page mid-search cancels it, otherwise you could get
      // paired into a game while looking at something else entirely.
      if (searchingRef.current) s.emit("quickPairing:leave");
    };
  }, [socket, navigate]);

  // "Waited N s" counter on the searching screen.
  useEffect(() => {
    if (!searchingId) {
      setWaitedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(
      () => setWaitedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [searchingId]);

  function handlePlay() {
    if (!socket || !selectedId) return;
    setError("");
    setStarting(true);
    socket.emit("quickPairing:join", { segmentId: selectedId });
  }

  function handleCancel() {
    socket?.emit("quickPairing:leave");
  }

  const searching = segments?.find((s) => s.id === searchingId) ?? null;

  return (
    <Page
      title="Quick pairing"
      responsiveDescription
      description="Pick a lobby and get paired with someone close to your rating."
      back="/"
    >
      <div className="mx-auto max-w-md space-y-4 pb-4">
        {!segments ? (
          <div className="flex justify-center pt-10">
            <Spinner className="text-base-content/40" />
          </div>
        ) : searching ? (
          <Card variant="solid">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <Spinner className="text-primary" />
              <div>
                <p className="text-lg font-semibold text-base-content">
                  Pairing you now…
                </p>
                <p className="mt-1 text-sm text-base-content/60">
                  Looking for a {searching.label}
                  {searching.variant === "chess960" ? " Chess960" : ""} opponent
                  {typeof user?.rating === "number" && (
                    <>
                      {" "}
                      near <RatingBadge rating={user.rating} />
                    </>
                  )}
                  . {waitedSeconds}s
                </p>
                <p className="mt-1 text-xs text-base-content/40">
                  The longer you wait, the wider the rating range gets.
                </p>
              </div>
              <Button variant="outline" onClick={handleCancel}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {segments.map((seg) => {
                const selected = seg.id === selectedId;
                const n = counts[seg.id] ?? 0;
                return (
                  <button
                    key={seg.id}
                    type="button"
                    onClick={() => setSelectedId(seg.id)}
                    className="text-left"
                  >
                    <Card
                      variant="solid"
                      interactive
                      className={cn(
                        "flex h-full flex-col gap-2 p-4 transition-shadow",
                        selected && "ring-2 ring-primary",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <TimeControlIcon
                          baseMinutes={seg.baseMinutes}
                          size={18}
                        />
                        {seg.variant === "chess960" && (
                          <Badge variant="secondary">960</Badge>
                        )}
                      </div>
                      <div>
                        <p className="text-2xl font-bold tabular-nums text-base-content">
                          {seg.label}
                        </p>
                        <p className="text-xs text-base-content/50">
                          {seg.variant === "chess960"
                            ? "Chess960"
                            : seg.categoryLabel}
                        </p>
                      </div>
                      <p className="flex items-center gap-1 text-xs text-base-content/60">
                        <Users className="h-3.5 w-3.5" />
                        {n} {n === 1 ? "player" : "players"} waiting
                      </p>
                    </Card>
                  </button>
                );
              })}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <Button
              size="lg"
              fullWidth
              disabled={!selectedId || starting || !socket}
              onClick={handlePlay}
            >
              {starting ? "Joining…" : "Play"}
            </Button>
          </>
        )}
      </div>
    </Page>
  );
}

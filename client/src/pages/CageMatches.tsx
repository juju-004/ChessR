import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  listMyCageMatches,
  computeCageStandings,
  type CageMatch,
} from "../api/cageMatches.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { Pagination } from "../components/Pagination.js";
import { RefreshButton } from "../components/RefreshButton.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
} from "../components/ui/index.js";
import { formatRelativeTime } from "@/lib/utils.js";
import { cn } from "@/lib/cn.js";

// Client-side page size for Match history, listMyCageMatches already
// returns the full set in one request, so this just slices the array
// that's already in memory rather than rendering a potentially long list
// all at once. Same pattern as Tournaments.tsx.
const PAGE_SIZE = 8;

function opponentOf(match: CageMatch, myId: string | undefined) {
  return match.player1._id === myId ? match.player2 : match.player1;
}

function matchOutcomeLabel(match: CageMatch, myId: string | undefined): string {
  if (match.status !== "finished") return "In progress";
  if (match.matchWinner === "draw") return "Drawn";
  const iAmP1 = match.player1._id === myId;
  const iWon =
    (match.matchWinner === "p1" && iAmP1) ||
    (match.matchWinner === "p2" && !iAmP1);
  return iWon ? "You won" : "You lost";
}

function CageMatchRow({ m, myId }: { m: CageMatch; myId: string | undefined }) {
  const opp = opponentOf(m, myId);

  if (m.status === "active") {
    const standings = computeCageStandings(m);
    const iAmP1 = m.player1._id === myId;
    const myScore = iAmP1 ? standings.p1Score : standings.p2Score;
    const oppScore = iAmP1 ? standings.p2Score : standings.p1Score;
    return (
      <Link
        to={`/cage/${m.matchCode}`}
        className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
      >
        <span className="min-w-0 truncate text-sm text-base-content">
          vs {opp.username} · game {m.currentLegIndex + 1}/{m.legs.length}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm text-base-content/60">
          {myScore}–{oppScore}
          {m.wagerMode !== "none" && (
            <Badge variant="warning">{m.wagerTokens} R</Badge>
          )}
        </span>
      </Link>
    );
  }

  const outcome = matchOutcomeLabel(m, myId);
  return (
    <Link
      to={`/cage/${m.matchCode}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
    >
      <div className="min-w-0">
        <span className="text-sm text-base-content">
          You <span className="text-base-content/60">vs</span> {opp.username}
        </span>
        <div className="mt-0.5 text-xs text-base-content/50">
          {formatRelativeTime(m.createdAt)}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm text-base-content/60",
          outcome === "You won" && "text-green-600",
          outcome === "You lost" && "text-red-500",
        )}
      >
        {outcome}
      </span>
    </Link>
  );
}

/** A card of match rows with its own local page state, used for Match
 *  history, which can realistically grow long. Active matches stay
 *  unpaginated since there's rarely more than a handful at once. */
function PaginatedMatchCard({
  title,
  matches,
  myId,
  emptyMessage,
}: {
  title: string;
  matches: CageMatch[];
  myId: string | undefined;
  emptyMessage: string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  // Clamp rather than reset to 0 outright, keeps you on the same page
  // after the list shrinks by one instead of always bouncing back to page 1.
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = matches.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {matches.length === 0 && (
          <p className="text-sm text-base-content/50">{emptyMessage}</p>
        )}
        {pageItems.map((m) => (
          <CageMatchRow key={m._id} m={m} myId={myId} />
        ))}
        <Pagination
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
        />
      </CardContent>
    </Card>
  );
}

export function CageMatches() {
  const socket = useSocket();
  const { user } = useAuth();
  const myId = user?.id;
  const navigate = useNavigate();
  const location = useLocation();
  const [matches, setMatches] = useState<CageMatch[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(
    (
      location.state as {
        status?: { message: string; isError: boolean };
      } | null
    )?.status ?? null,
  );

  const activeMatches = matches.filter((m) => m.status === "active");
  const finishedMatches = matches.filter((m) => m.status !== "active");

  const refreshMatches = useCallback(() => {
    return listMyCageMatches().then((res) => setMatches(res.matches));
  }, []);

  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    refreshMatches().finally(() => setRefreshing(false));
  }, [refreshMatches]);

  useEffect(() => {
    refreshMatches();
  }, [refreshMatches]);

  // The success message set by CreateCageMatch on navigation is only
  // meant to be shown once, clear it from history state so a refresh or
  // the back button doesn't keep re-triggering it.
  useEffect(() => {
    if (location.state) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!socket) return;
    function onDeclined() {
      setStatus({
        message: "Your cage match invite was declined.",
        isError: true,
      });
    }
    function onAccepted() {
      setStatus({
        message: "Cage match started! Check your active matches below.",
        isError: false,
      });
      refreshMatches();
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }
    socket.on("cage:declined", onDeclined);
    socket.on("cage:accepted", onAccepted);
    socket.on("cage:error", onError);
    socket.on("cage:next_leg", refreshMatches);
    socket.on("cage:match_over", refreshMatches);
    return () => {
      socket.off("cage:declined", onDeclined);
      socket.off("cage:accepted", onAccepted);
      socket.off("cage:error", onError);
      socket.off("cage:next_leg", refreshMatches);
      socket.off("cage:match_over", refreshMatches);
    };
  }, [socket, refreshMatches]);

  return (
    <Page
      title="Cage matches"
      description={
        <span className="hidden sm:inline">
          Challenge a friend to an ordered series of games.
        </span>
      }
      actions={
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate("/cage/new")}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create cage match</span>
          <span className="sm:hidden">New</span>
        </Button>
      }
    >
      <div className="mx-auto space-y-4">
        {status && (
          <p
            className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
          >
            {status.message}
          </p>
        )}

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Active cage matches</CardTitle>
            <RefreshButton
              onRefresh={handleManualRefresh}
              refreshing={refreshing}
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {activeMatches.length === 0 && (
              <p className="text-sm text-base-content/50">None right now.</p>
            )}
            {activeMatches.map((m) => (
              <CageMatchRow key={m._id} m={m} myId={myId} />
            ))}
          </CardContent>
        </Card>

        <PaginatedMatchCard
          title="Match history"
          matches={finishedMatches}
          myId={myId}
          emptyMessage="No finished cage matches yet."
        />
      </div>
    </Page>
  );
}

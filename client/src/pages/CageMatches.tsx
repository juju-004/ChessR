import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  listMyCageMatches,
  listMyFinishedCageMatches,
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
  Spinner,
} from "../components/ui/index.js";
import { formatRelativeTime } from "@/lib/utils.js";
import { cn } from "@/lib/cn.js";
import { claimToast } from "../lib/toastClaims.js";

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

/** Finished matches card. Each page is its own request (5 matches, newest
 *  first), so the whole history never travels in one response. Active
 *  matches stay unpaginated since there's rarely more than a handful. */
function ServerPagedMatchCard({
  title,
  matches,
  myId,
  page,
  pageCount,
  onPageChange,
  emptyMessage,
  loading = false,
}: {
  title: string;
  matches: CageMatch[];
  myId: string | undefined;
  /** 0-based, same as <Pagination>. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  emptyMessage: string;
  /** True until the first page arrives, shows a spinner instead of the
   *  empty message so "No finished cage matches yet" doesn't flash before
   *  the real list lands. Later page changes keep the current rows up. */
  loading?: boolean;
}) {
  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="text-base-content/40" />
          </div>
        ) : (
          <>
            {matches.length === 0 && (
              <p className="text-sm text-base-content/50">{emptyMessage}</p>
            )}
            {matches.map((m) => (
              <CageMatchRow key={m._id} m={m} myId={myId} />
            ))}
            <Pagination
              page={page}
              pageCount={pageCount}
              onPageChange={onPageChange}
            />
          </>
        )}
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
  // Active matches come from the default call; finished ones are paged
  // by the server, one 5-match page per request (0-based page here).
  const [activeMatches, setActiveMatches] = useState<CageMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [finishedMatches, setFinishedMatches] = useState<CageMatch[]>([]);
  const [finishedPage, setFinishedPage] = useState(0);
  const [finishedPageCount, setFinishedPageCount] = useState(1);
  const [finishedLoading, setFinishedLoading] = useState(true);
  // Latest page for refreshMatches to re-fetch without becoming a dependency
  // (which would re-subscribe the socket listeners on every page flip).
  const finishedPageRef = useRef(0);
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

  const loadFinished = useCallback((page: number) => {
    return listMyFinishedCageMatches(page + 1)
      .then((res) => {
        setFinishedMatches(res.matches);
        setFinishedPageCount(res.totalPages);
        // The server clamps a stale page (list shrank) to the last real one.
        finishedPageRef.current = res.page - 1;
        setFinishedPage(res.page - 1);
      })
      .finally(() => setFinishedLoading(false));
  }, []);

  const refreshMatches = useCallback(() => {
    return Promise.all([
      listMyCageMatches()
        .then((res) =>
          setActiveMatches(res.matches.filter((m) => m.status === "active")),
        )
        .finally(() => setMatchesLoading(false)),
      loadFinished(finishedPageRef.current),
    ]);
  }, [loadFinished]);

  const handleFinishedPageChange = useCallback(
    (page: number) => {
      finishedPageRef.current = page;
      setFinishedPage(page);
      loadFinished(page);
    },
    [loadFinished],
  );

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
    const release0 = claimToast("cage:error");
    const release1 = claimToast("cage:declined");
    socket.on("cage:error", onError);
    socket.on("cage:next_leg", refreshMatches);
    socket.on("cage:match_over", refreshMatches);
    return () => {
      socket.off("cage:declined", onDeclined);
      socket.off("cage:accepted", onAccepted);
      release0();
      release1();
      socket.off("cage:error", onError);
      socket.off("cage:next_leg", refreshMatches);
      socket.off("cage:match_over", refreshMatches);
    };
  }, [socket, refreshMatches]);

  return (
    <Page
      title="Cage matches"
      responsiveDescription
      description="Challenge a player to an ordered series of games."
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
            <CardTitle>Active</CardTitle>
            <RefreshButton
              onRefresh={handleManualRefresh}
              refreshing={refreshing}
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {matchesLoading ? (
              <div className="flex justify-center py-6">
                <Spinner className="text-base-content/40" />
              </div>
            ) : (
              <>
                {activeMatches.length === 0 && (
                  <p className="text-sm text-base-content/50">None right now.</p>
                )}
                {activeMatches.map((m) => (
                  <CageMatchRow key={m._id} m={m} myId={myId} />
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <ServerPagedMatchCard
          title="Finished"
          matches={finishedMatches}
          myId={myId}
          page={finishedPage}
          pageCount={finishedPageCount}
          onPageChange={handleFinishedPageChange}
          emptyMessage="No finished cage matches yet."
          loading={finishedLoading}
        />
      </div>
    </Page>
  );
}

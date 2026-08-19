import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  listOpenTournaments,
  listMyTournaments,
  FORMAT_LABEL,
  formatTimeControl,
  type Tournament,
} from "../api/tournaments.js";
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

// Client-side page size for the Open tournaments and Finished tourneys
// lists — both endpoints already return their full set in one request
// (see listOpenTournaments/listMyTournaments), so there's no server-side
// pagination to plug into; this just slices the array that's already in
// memory rather than rendering a potentially long list all at once.
const PAGE_SIZE = 8;

const STATUS_VARIANT: Record<
  Tournament["status"],
  "neutral" | "success" | "error"
> = {
  pending: "neutral",
  active: "success",
  finished: "neutral",
  cancelled: "error",
};

function TournamentRow({ t }: { t: Tournament }) {
  return (
    <Link
      to={`/tournaments/${t.code}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-base-content">{t.name}</span>
          <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-base-content/50">
          {FORMAT_LABEL[t.format]} · {formatTimeControl(t)} · {t.players.length}
          /{t.maxPlayers} players
          {t.regFeeTokens > 0 && <> · {t.regFeeTokens} R to join</>}
          {t.prizePoolTokens > 0 && <> · {t.prizePoolTokens} R prize pool</>}
        </div>
      </div>
      <span className="shrink-0 text-xs text-base-content/40">#{t.code}</span>
    </Link>
  );
}

/** A card of tournament rows with its own local page state — used for the
 *  two lists that can realistically grow long (Open tournaments, Finished
 *  tourneys). Active tourneys / in-progress stay unpaginated since there's
 *  rarely more than a handful at once. */
function PaginatedTournamentCard({
  title,
  tournaments,
  emptyMessage,
  onRefresh,
  refreshing,
}: {
  title: string;
  tournaments: Tournament[];
  emptyMessage: string;
  /** Omit to render the card without a refresh button (e.g. Finished
   *  tourneys, which doesn't need one). */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(tournaments.length / PAGE_SIZE));
  // Clamp rather than reset to 0 outright — keeps you on the same page
  // after a list shrinks by one (e.g. a tournament you were tracking just
  // finished and moved lists) instead of always bouncing back to page 1.
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = tournaments.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {onRefresh && (
          <RefreshButton onRefresh={onRefresh} refreshing={!!refreshing} />
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {tournaments.length === 0 && (
          <p className="text-sm text-base-content/50">{emptyMessage}</p>
        )}
        {pageItems.map((t) => (
          <TournamentRow key={t._id} t={t} />
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

export function Tournaments() {
  const socket = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Tournament[]>([]);
  const [mine, setMine] = useState<Tournament[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    const tasks: Promise<unknown>[] = [
      listOpenTournaments().then((res) => setOpen(res.tournaments)),
    ];
    if (user) tasks.push(listMyTournaments().then((res) => setMine(res.tournaments)));
    return Promise.all(tasks);
  }, [user]);

  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    socket.on("tournament:update", refresh);
    socket.on("tournament:started", refresh);
    socket.on("tournament:cancelled", refresh);
    return () => {
      socket.off("tournament:update", refresh);
      socket.off("tournament:started", refresh);
      socket.off("tournament:cancelled", refresh);
    };
  }, [socket, refresh]);

  const openPending = useMemo(
    () => open.filter((t) => t.status === "pending"),
    [open],
  );
  const openActive = useMemo(
    () => open.filter((t) => t.status === "active"),
    [open],
  );
  // "Active tourneys" — yours, currently pending or under way, i.e.
  // anything you'd still want to check in on. Split out from "Finished
  // tourneys" below so the two don't get mixed together under one
  // ever-growing list.
  const mineActive = useMemo(
    () => mine.filter((t) => t.status === "pending" || t.status === "active"),
    [mine],
  );
  const mineFinished = useMemo(
    () => mine.filter((t) => t.status === "finished"),
    [mine],
  );

  return (
    <Page
      title="Tournaments"
      description={
        <span className="hidden sm:inline">
          Run a knockout bracket, a swiss or arena event, or a round-robin.
        </span>
      }
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate("/tournaments/new")}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create tournament</span>
          <span className="sm:hidden">New</span>
        </Button>
      }
    >
      <div className="mx-auto space-y-4">
        <PaginatedTournamentCard
          title="Open tournaments"
          tournaments={openPending}
          emptyMessage="No public tournaments waiting for players right now."
          onRefresh={handleManualRefresh}
          refreshing={refreshing}
        />

        {mineActive.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Active tourneys</CardTitle>
              <RefreshButton onRefresh={handleManualRefresh} refreshing={refreshing} />
            </CardHeader>
            <CardContent className="space-y-2">
              {mineActive.map((t) => (
                <TournamentRow key={t._id} t={t} />
              ))}
            </CardContent>
          </Card>
        )}

        {openActive.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>In progress</CardTitle>
              <RefreshButton onRefresh={handleManualRefresh} refreshing={refreshing} />
            </CardHeader>
            <CardContent className="space-y-2">
              {openActive.map((t) => (
                <TournamentRow key={t._id} t={t} />
              ))}
            </CardContent>
          </Card>
        )}

        <PaginatedTournamentCard
          title="Finished tourneys"
          tournaments={mineFinished}
          emptyMessage="Nothing finished yet."
        />
      </div>
    </Page>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trophy } from "lucide-react";
import { listTeamTournaments } from "../../api/teams.js";
import type { Tournament } from "../../api/tournaments.js";
import { errMsg } from "../../lib/errMsg.js";
import { TournamentRow } from "../tournaments/TournamentRow.js";
import { Pagination } from "../Pagination.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Spinner } from "../ui/Spinner.js";
import { Tabs } from "../ui/Tabs.js";

type Scope = "upcoming" | "finished";

/** A team's in-house tournaments, split into upcoming/active and finished.
 *  The owner can organise a new one, which opens the normal tournament
 *  creator pre-set for this team (members-only, never listed publicly). */
export function TeamTournamentsTab({
  teamId,
  isOwner,
}: {
  teamId: string;
  isOwner: boolean;
}) {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>("upcoming");
  const [page, setPage] = useState(0); // 0-based for <Pagination>
  const [pageCount, setPageCount] = useState(1);
  const [items, setItems] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listTeamTournaments(teamId, scope, page + 1);
      setItems(r.tournaments);
      setPageCount(r.totalPages ?? 1);
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [teamId, scope, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="overflow-x-auto">
          <Tabs
            items={[
              { value: "upcoming", label: "Active" },
              { value: "finished", label: "Finished" },
            ]}
            value={scope}
            onChange={(v) => {
              setScope(v as Scope);
              setPage(0);
            }}
          />
        </div>
        {isOwner && (
          <Button
            size="sm"
            onClick={() => navigate(`/tournaments/new?team=${teamId}`)}
          >
            <Plus className="h-4 w-4" /> New{" "}
            <span className="md:inline-flex hidden">tournament</span>
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500"
        >
          {error}
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center">
          <Trophy className="mx-auto mb-2 h-8 w-8 text-base-content/30" />
          <p className="font-medium">
            {scope === "upcoming"
              ? "No active tournaments"
              : "No finished tournaments yet"}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <TournamentRow key={t._id} t={t} />
          ))}
        </div>
      )}

      {scope === "finished" && (
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      )}
    </div>
  );
}

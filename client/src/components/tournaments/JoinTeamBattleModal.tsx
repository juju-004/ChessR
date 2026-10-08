import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { listMyTeams } from "../../api/teams.js";
import type { TeamBattleConfig } from "../../api/tournaments.js";
import { Modal, Button, Input, Spinner } from "../ui/index.js";
import { cn } from "@/lib/cn.js";

/** Join flow for a team battle: pick which of the battle's teams you're
 *  playing for (only teams you belong to can be chosen), plus the
 *  tournament password when it has one. */
export function JoinTeamBattleModal({
  open,
  tournamentName,
  battle,
  needsPassword,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  tournamentName: string;
  battle: TeamBattleConfig;
  needsPassword: boolean;
  error: string;
  onSubmit: (teamId: string, password: string) => void;
  onClose: () => void;
}) {
  const [myTeamIds, setMyTeamIds] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setLoadError("");
    setMyTeamIds(null);
    let cancelled = false;
    listMyTeams()
      .then((r) => {
        if (cancelled) return;
        const ids = new Set(r.teams.map((t) => t.id));
        setMyTeamIds(ids);
        const eligible = battle.teams.filter((t) => ids.has(t.team));
        setSelected(eligible.length === 1 ? eligible[0].team : null);
      })
      .catch(() => !cancelled && setLoadError("Could not load your teams"));
    return () => {
      cancelled = true;
    };
  }, [open, battle.teams]);

  const eligible = myTeamIds ? battle.teams.filter((t) => myTeamIds.has(t.team)) : [];
  const canSubmit = !!selected && (!needsPassword || password.trim().length > 0);

  return (
    <Modal open={open} onClose={onClose} title="Join team battle" icon={<Users className="h-4 w-4" />}>
      <div className="space-y-3 px-2 pb-1">
        <p className="text-sm text-base-content/60">
          Choose the team you're playing for in{" "}
          <span className="font-semibold text-base-content">{tournamentName}</span>.
        </p>

        {!myTeamIds && !loadError && (
          <div className="flex justify-center py-4">
            <Spinner className="text-base-content/40" />
          </div>
        )}
        {loadError && <p className="text-xs text-red-400">{loadError}</p>}

        {myTeamIds && eligible.length > 0 && (
          <div className="space-y-2">
            {eligible.map((t) => (
              <button
                key={t.team}
                type="button"
                onClick={() => setSelected(t.team)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                  selected === t.team
                    ? "border-(--secondary)/60 bg-(--secondary)/10 text-base-content"
                    : "border-base-300 bg-base-100/60 text-base-content/70 hover:border-(--secondary)/30",
                )}
              >
                <span className="truncate font-medium">{t.name}</span>
                {selected === t.team && <span className="text-xs text-(--secondary)">Selected</span>}
              </button>
            ))}
          </div>
        )}

        {myTeamIds && eligible.length === 0 && (
          <div className="space-y-2 rounded-xl bg-base-200/60 p-3 text-sm text-base-content/70">
            <p>You're not a member of any team in this battle. Join one of them first:</p>
            <ul className="space-y-1">
              {battle.teams.map((t) => (
                <li key={t.team}>
                  <Link to={`/teams/${t.team}`} className="text-(--primary) hover:underline">
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {needsPassword && eligible.length > 0 && (
          <Input
            type="password"
            placeholder="Tournament password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="glass" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canSubmit}
            onClick={() => selected && onSubmit(selected, password)}
          >
            Join
          </Button>
        </div>
      </div>
    </Modal>
  );
}

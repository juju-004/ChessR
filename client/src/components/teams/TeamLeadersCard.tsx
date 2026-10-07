import { useCallback, useEffect, useState } from "react";
import { Crown, Shield, ShieldMinus, ShieldPlus } from "lucide-react";
import { addTeamLeader, listTeamMembers, removeTeamLeader, type TeamMember } from "../../api/teams.js";
import { errMsg } from "../../lib/errMsg.js";
import { useAuth } from "../../contexts/AuthContext.js";
import { useConfirm } from "../../contexts/ConfirmContext.js";
import { Avatar } from "../ui/Avatar.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";
import { Spinner } from "../ui/Spinner.js";

/** Settings card for leaders. Any leader can add or remove other leaders,
 *  but the creator (owner) is permanent: they get no remove button here and
 *  the server refuses it too. */
export function TeamLeadersCard({ teamId, refreshKey, onChanged }: { teamId: string; refreshKey: number; onChanged: () => void }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [leaders, setLeaders] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadLeaders = useCallback(async () => {
    try {
      const r = await listTeamMembers(teamId, 1, { leadersOnly: true });
      setLeaders(r.members);
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    loadLeaders();
  }, [loadLeaders, refreshKey]);

  // Debounced member search for the "add a leader" picker.
  const q = query.trim();
  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await listTeamMembers(teamId, 1, { q });
        setResults(r.members.filter((m) => m.role === "member").slice(0, 8));
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, teamId, refreshKey]);

  async function add(m: TeamMember) {
    setBusyId(m.id);
    setError("");
    try {
      await addTeamLeader(teamId, m.id);
      setResults((r) => r.filter((x) => x.id !== m.id));
      await loadLeaders();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m: TeamMember) {
    const self = m.id === user?.id;
    const ok = await confirm({
      title: self ? "Step down as leader?" : `Remove ${m.username} as leader?`,
      description: self
        ? "You'll become a regular member and won't be able to post announcements or manage leaders."
        : "They stay in the team as a regular member.",
      confirmLabel: self ? "Step down" : "Remove",
      variant: "danger",
    });
    if (!ok) return;
    setBusyId(m.id);
    setError("");
    try {
      await removeTeamLeader(teamId, m.id);
      await loadLeaders();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="font-semibold">Leaders</h3>
      <p className="mt-1 text-sm text-base-content/60">
        Leaders can post and pin announcements and add or remove other leaders. The team creator is always a leader
        and can't be removed.
      </p>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="mt-3 divide-y divide-base-300/60 rounded-xl border border-base-300/60">
          {leaders.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar username={m.username} src={m.avatarUrl} gradient={m.avatarGradient} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.username}</span>
              {m.role === "owner" ? (
                <Badge variant="warning"><Crown className="h-3 w-3" /> Creator</Badge>
              ) : (
                <>
                  <Badge variant="primary"><Shield className="h-3 w-3" /> Leader</Badge>
                  <button
                    type="button"
                    onClick={() => remove(m)}
                    disabled={busyId === m.id}
                    aria-label={m.id === user?.id ? "Step down as leader" : `Remove ${m.username} as leader`}
                    title={m.id === user?.id ? "Step down" : "Remove leader"}
                    className="p-1 text-base-content/40 hover:text-red-500 disabled:opacity-40"
                  >
                    <ShieldMinus className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Input
          label="Add a leader"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members by username"
          autoComplete="off"
          maxLength={24}
        />
        {q && (
          <div className="mt-2">
            {searching && results.length === 0 ? (
              <div className="flex justify-center py-3"><Spinner /></div>
            ) : results.length === 0 ? (
              <p className="px-1 text-sm text-base-content/50">No regular members match "{q}".</p>
            ) : (
              <div className="divide-y divide-base-300/60 rounded-xl border border-base-300/60">
                {results.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <Avatar username={m.username} src={m.avatarUrl} gradient={m.avatarGradient} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.username}</span>
                    <Button size="sm" variant="outline" loading={busyId === m.id} onClick={() => add(m)}>
                      <ShieldPlus className="h-4 w-4" /> Make leader
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

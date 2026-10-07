import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Crown, KeyRound, Lock, Plus, Search, Users } from "lucide-react";
import {
  createTeam,
  listMyTeams,
  searchTeams,
  type TeamSummary,
} from "../api/teams.js";
import { errMsg } from "../lib/errMsg.js";
import { useSocket } from "../contexts/SocketContext.js";
import { JoinTeamButton } from "../components/teams/JoinTeamButton.js";
import { Page } from "@/components/ui/Page.js";
import { Card } from "@/components/ui/Card.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { EmojiInput } from "@/components/ui/EmojiInput.js";
import { Textarea } from "@/components/ui/Textarea.js";
import { Switch } from "@/components/ui/Switch.js";
import { Badge } from "@/components/ui/Badge.js";
import { Modal } from "@/components/ui/Modal.js";
import { Tabs } from "@/components/ui/Tabs.js";
import { Spinner } from "@/components/ui/Spinner.js";

/** Teams hub: your teams, finding teams, creating one. Everything about a
 *  single team (chat, tournaments, members, settings) lives on its own page,
 *  /teams/:id. You can own at most `ownedLimit` teams at once; joining other
 *  people's teams is unlimited. */
export function Teams() {
  const navigate = useNavigate();
  const socket = useSocket();
  const [tab, setTab] = useState<"mine" | "find">("mine");
  const [mine, setMine] = useState<TeamSummary[]>([]);
  const [ownedCount, setOwnedCount] = useState(0);
  const [ownedLimit, setOwnedLimit] = useState(3);
  const [mineLoading, setMineLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const atOwnerLimit = ownedCount >= ownedLimit;

  const refreshMine = useCallback(async () => {
    try {
      const r = await listMyTeams();
      setMine(r.teams);
      setOwnedCount(r.ownedCount);
      setOwnedLimit(r.ownedLimit);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setMineLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMine();
  }, [refreshMine]);

  const runSearch = useCallback(async (q: string) => {
    try {
      const { teams } = await searchTeams(q);
      setResults(teams);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced; with an empty box it lists the newest teams so the tab is
  // never blank.
  useEffect(() => {
    if (tab !== "find") return;
    setSearching(true);
    const t = setTimeout(() => runSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query, tab, runSearch]);

  // Someone accepted/declined my request: reflect it without a reload.
  useEffect(() => {
    if (!socket) return;
    const onResolved = () => {
      refreshMine();
      if (tab === "find") runSearch(query.trim());
    };
    socket.on("team:request_resolved", onResolved);
    return () => {
      socket.off("team:request_resolved", onResolved);
    };
  }, [socket, tab, query, refreshMine, runSearch]);

  function onJoinChanged(team: TeamSummary, result: "joined" | "requested" | "cancelled") {
    if (result === "joined") return navigate(`/teams/${team.id}`);
    setResults((r) => r.map((x) => (x.id === team.id ? { ...x, requestPending: result === "requested" } : x)));
  }

  return (
    <Page
      title="Teams"
      description="Chat, organise in-house tournaments and play together."
      actions={
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={atOwnerLimit}
          title={atOwnerLimit ? `You already own ${ownedLimit} teams` : undefined}
        >
          <Plus className="h-4 w-4" /> New team
        </Button>
      }
    >
      <div className="mb-4 overflow-x-auto">
        <Tabs
          items={[
            { value: "mine", label: `My teams (${mine.length})` },
            { value: "find", label: "Find teams" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as "mine" | "find")}
        />
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      {tab === "mine" && (
        <>
          {mineLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : mine.length === 0 ? (
            <Card className="p-8 text-center">
              <Users className="mx-auto mb-2 h-8 w-8 text-base-content/30" />
              <p className="font-medium">You're not in any team yet</p>
              <p className="mt-1 text-sm text-base-content/60">Create one or find a team to join.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New team</Button>
                <Button size="sm" variant="outline" onClick={() => setTab("find")}>Find teams</Button>
              </div>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {mine.map((t) => (
                <TeamCard key={t.id} team={t} onOpen={() => navigate(`/teams/${t.id}`)}>
                  <Button size="sm" variant={t.isOwner ? "primary" : "outline"} onClick={() => navigate(`/teams/${t.id}`)}>
                    {t.isOwner ? "Manage" : "Open"}
                  </Button>
                </TeamCard>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-base-content/50">
            You own {ownedCount} of {ownedLimit} teams. You can join as many teams as you like.
          </p>
        </>
      )}

      {tab === "find" && (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams by name"
            maxLength={24}
            leadingIcon={<Search className="h-4 w-4" />}
            aria-label="Search teams"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {searching && results.length === 0 ? (
              <div className="col-span-full flex justify-center py-8"><Spinner /></div>
            ) : results.length === 0 ? (
              <p className="col-span-full py-8 text-center text-sm text-base-content/50">No teams found.</p>
            ) : (
              results.map((t) => (
                <TeamCard key={t.id} team={t} onOpen={() => navigate(`/teams/${t.id}`)}>
                  {t.isMember ? (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/teams/${t.id}`)}>Open</Button>
                  ) : (
                    <JoinTeamButton
                      team={t}
                      onChanged={(r) => onJoinChanged(t, r)}
                      onError={setError}
                    />
                  )}
                </TeamCard>
              ))
            )}
          </div>
        </>
      )}

      <CreateTeamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          navigate(`/teams/${id}`);
        }}
      />
    </Page>
  );
}

function TeamCard({
  team,
  onOpen,
  children,
}: {
  team: TeamSummary;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold">{team.name}</h3>
          {team.isOwner && <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-label="Owner" />}
          {team.hasCode && <KeyRound className="h-3.5 w-3.5 shrink-0 text-base-content/40" aria-label="Entry code" />}
          {!team.hasCode && team.joinMode === "request" && (
            <Lock className="h-3.5 w-3.5 shrink-0 text-base-content/40" aria-label="Approval needed" />
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 min-h-8 text-sm text-base-content/60">
          {team.description || "No description"}
        </p>
        <p className="mt-1 text-xs text-base-content/50">
          {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
        </p>
      </button>
      <div className="flex items-center gap-2">
        {children}
        {!team.isMember && team.joinMode === "request" && !team.hasCode && !team.requestPending && (
          <Badge variant="neutral">Approval needed</Badge>
        )}
      </div>
    </Card>
  );
}

function CreateTeamModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [entryCode, setEntryCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setNeedsApproval(false);
      setEntryCode("");
      setError("");
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { id } = await createTeam({
        name: name.trim(),
        description: description.trim(),
        joinMode: needsApproval ? "request" : "open",
        ...(entryCode.trim() ? { entryCode: entryCode.trim() } : {}),
      });
      onCreated(id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a team" icon={<Users className="h-4 w-4" />} className="max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-3 px-2 pb-2">
        <EmojiInput
          label="Team name"
          value={name}
          onChange={setName}
          minLength={3}
          maxLength={24}
          required
          placeholder="e.g. Knight Riders"
        />
        <Textarea
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={160}
          rows={3}
        />
        <Switch
          checked={needsApproval}
          onChange={setNeedsApproval}
          label="Approve new members"
          description="On: people send a request and you accept or decline. Off: anyone can join straight away."
        />
        <Input
          label="Entry code (optional)"
          value={entryCode}
          onChange={(e) => setEntryCode(e.target.value)}
          maxLength={16}
          autoComplete="off"
          hint="4–16 letters or numbers. Anyone with the code joins instantly, and without one people can't join directly."
        />
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={name.trim().length < 3}>Create team</Button>
        </div>
      </form>
    </Modal>
  );
}

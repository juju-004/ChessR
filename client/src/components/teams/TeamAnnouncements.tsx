import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Megaphone, Pin, PinOff, Trash2 } from "lucide-react";
import {
  createTeamAnnouncement,
  deleteTeamAnnouncement,
  listTeamAnnouncements,
  pinTeamAnnouncement,
  type TeamAnnouncement,
} from "../../api/teams.js";
import { errMsg } from "../../lib/errMsg.js";
import { useConfirm } from "../../contexts/ConfirmContext.js";
import { useIsDesktop } from "../../hooks/useIsDesktop.js";
import { Avatar } from "../ui/Avatar.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";
import { Modal } from "../ui/Modal.js";
import { Spinner } from "../ui/Spinner.js";
import { Switch } from "../ui/Switch.js";
import { Textarea } from "../ui/Textarea.js";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Latest five announcements (pinned ones stay on top and are never pushed
 *  out). Everyone in the team reads them; only leaders can post, pin and
 *  delete. */
export function TeamAnnouncements({
  teamId,
  isLeader,
  refreshKey,
}: {
  teamId: string;
  isLeader: boolean;
  refreshKey: number;
}) {
  const confirm = useConfirm();
  const isDesktop = useIsDesktop();
  const [items, setItems] = useState<TeamAnnouncement[]>([]);
  const [maxPinned, setMaxPinned] = useState(3);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pin, setPin] = useState(false);
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await listTeamAnnouncements(teamId);
      setItems(r.announcements);
      setMaxPinned(r.maxPinned);
      setPinnedCount(r.pinnedCount);
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    setError("");
    try {
      await createTeamAnnouncement(teamId, { title: title.trim(), body: body.trim(), pinned: pin });
      setTitle("");
      setBody("");
      setPin(false);
      setComposing(false);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setPosting(false);
    }
  }

  async function togglePin(a: TeamAnnouncement) {
    setBusyId(a.id);
    setError("");
    try {
      await pinTeamAnnouncement(teamId, a.id, !a.pinned);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: TeamAnnouncement) {
    if (!(await confirm({ title: "Delete this announcement?", confirmLabel: "Delete", variant: "danger" }))) return;
    setBusyId(a.id);
    try {
      await deleteTeamAnnouncement(teamId, a.id);
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  const pinsFull = pinnedCount >= maxPinned;

  const composeForm = (
    <form onSubmit={post} className="flex flex-col gap-3">
      <Input
        label="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={60}
        autoComplete="off"
      />
      <Textarea
        label="Announcement"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={600}
        rows={3}
        required
        hint={`${body.length}/600`}
      />
      <Switch
        checked={pin}
        onChange={setPin}
        disabled={pinsFull}
        label="Pin to the top"
        description={
          pinsFull
            ? `You already have ${maxPinned} pinned. Unpin one to pin another.`
            : "Pinned announcements stay at the top and don't get pushed down by newer ones."
        }
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setComposing(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={posting} disabled={!body.trim()}>
          Post
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      {isLeader && (
        <Card className="p-4">
          {/* PC: the form opens in a modal. Phone: it expands inline in the card. */}
          {!composing || isDesktop ? (
            <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
              <Megaphone className="h-4 w-4" /> New announcement
            </Button>
          ) : (
            composeForm
          )}
        </Card>
      )}

      {isDesktop && (
        <Modal open={composing} onClose={() => setComposing(false)} title="New announcement" icon={<Megaphone className="h-4 w-4" />}>
          <div className="px-2 pb-2">
            {error && <p role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
            {composeForm}
          </div>
        </Modal>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-base-content/60">
          No announcements yet.{isLeader ? " Post the first one above." : ""}
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <Card key={a.id} className={a.pinned ? "p-4 ring-1 ring-amber-500/30" : "p-4"}>
              <div className="flex items-start gap-3">
                {a.author && (
                  <Avatar username={a.author.username} src={a.author.avatarUrl} gradient={a.author.avatarGradient} size="sm" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-base-content/50">
                    <span className="font-medium text-base-content/80">{a.author?.username ?? "Unknown"}</span>
                    <span>{timeAgo(a.createdAt)}</span>
                    {a.pinned && (
                      <Badge variant="warning">
                        <Pin className="h-3 w-3" /> Pinned
                      </Badge>
                    )}
                  </div>
                  {a.title && <h3 className="mt-1 break-words text-sm font-semibold">{a.title}</h3>}
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-base-content/80">{a.body}</p>
                </div>
                {isLeader && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => togglePin(a)}
                      disabled={busyId === a.id || (!a.pinned && pinsFull)}
                      aria-label={a.pinned ? "Unpin announcement" : "Pin announcement"}
                      title={a.pinned ? "Unpin" : pinsFull ? `Max ${maxPinned} pinned` : "Pin"}
                      className="p-1 text-base-content/40 hover:text-amber-500 disabled:opacity-40 disabled:hover:text-base-content/40"
                    >
                      {a.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(a)}
                      disabled={busyId === a.id}
                      aria-label="Delete announcement"
                      title="Delete"
                      className="p-1 text-base-content/40 hover:text-red-500 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

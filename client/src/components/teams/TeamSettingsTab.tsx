import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { deleteTeam, updateTeam, type TeamDetail } from "../../api/teams.js";
import { errMsg } from "../../lib/errMsg.js";
import { useConfirm } from "../../contexts/ConfirmContext.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";
import { EmojiInput } from "../ui/EmojiInput.js";
import { Switch } from "../ui/Switch.js";
import { Textarea } from "../ui/Textarea.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Owner-only: details, how people join, and deleting the team. */
export function TeamSettingsTab({
  team,
  onSaved,
  onDeleted,
  middle,
}: {
  team: TeamDetail;
  onSaved: () => void;
  onDeleted: () => void;
  /** Rendered between the details form and the delete card. */
  middle?: ReactNode;
}) {
  const confirm = useConfirm();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [needsApproval, setNeedsApproval] = useState(team.joinMode === "request");
  const [code, setCode] = useState(team.entryCode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Pick up changes made elsewhere (another tab, a refetch).
  useEffect(() => {
    setName(team.name);
    setDescription(team.description);
    setNeedsApproval(team.joinMode === "request");
    setCode(team.entryCode ?? "");
  }, [team.name, team.description, team.joinMode, team.entryCode]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      await updateTeam(team.id, {
        name: name.trim(),
        description: description.trim(),
        joinMode: needsApproval ? "request" : "open",
        entryCode: code.trim() || null,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${team.name}?`,
      description: "This removes the team and its chat for everyone and can't be undone.",
      confirmLabel: "Delete team",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteTeam(team.id);
      onDeleted();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card className="p-4">
        <form onSubmit={save} className="flex flex-col gap-4">
          <EmojiInput label="Team name" value={name} onChange={setName} minLength={3} maxLength={24} required />
          <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} rows={3} />
          <Switch
            checked={needsApproval}
            onChange={setNeedsApproval}
            label="Approve new members"
            description="On: people send a request and you accept or decline. Off: anyone can join straight away. A correct entry code always lets someone in."
          />
          <div>
            <Input
              label="Entry code (optional)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={16}
              autoComplete="off"
              hint="4–16 letters or numbers. Leave empty for no code."
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setCode(generateCode())}>
                <RefreshCw className="h-4 w-4" /> Generate
              </Button>
              {code && (
                <>
                  <Button type="button" size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(code)}>
                    <Copy className="h-4 w-4" /> Copy
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCode("")}>
                    Remove code
                  </Button>
                </>
              )}
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-green-500">Saved</span>}
            <Button type="submit" loading={saving} disabled={name.trim().length < 3}>Save changes</Button>
          </div>
        </form>
      </Card>

      <div className="min-w-0 space-y-4">
      {middle}

      <Card className="border border-red-500/30 p-4">
        <h3 className="font-semibold">Delete team</h3>
        <p className="mt-1 text-sm text-base-content/60">
          Hand the team to another member from the member list if you'd rather leave it running. A team can't be
          deleted while it has pending or active tournaments.
        </p>
        <Button className="mt-3" variant="danger" size="sm" onClick={remove}>
          <Trash2 className="h-4 w-4" /> Delete team
        </Button>
      </Card>
      </div>
    </div>
  );
}

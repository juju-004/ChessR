import { useState } from "react";
import { KeyRound, Users } from "lucide-react";
import { cancelJoinRequest, joinTeam, type TeamSummary } from "../../api/teams.js";
import { errMsg } from "../../lib/errMsg.js";
import { Button } from "../ui/Button.js";
import { Input } from "../ui/Input.js";
import { Modal } from "../ui/Modal.js";

type Joinable = Pick<TeamSummary, "id" | "name" | "joinMode" | "hasCode" | "requestPending">;

/** The one place the join rules live on the client:
 *   - entry code set        -> opens a small dialog (code, and "request" if
 *                              the team approves members)
 *   - approval, no code     -> sends a request straight away
 *   - open, no code         -> joins straight away
 *  Shows "Requested" with a cancel option while a request is pending. */
export function JoinTeamButton({
  team,
  onChanged,
  onError,
  size = "sm",
}: {
  team: Joinable;
  onChanged: (result: "joined" | "requested" | "cancelled") => void;
  onError?: (message: string) => void;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function submit(withCode?: string) {
    setBusy(true);
    setError("");
    try {
      const { status } = await joinTeam(team.id, withCode);
      setOpen(false);
      setCode("");
      onChanged(status);
    } catch (err) {
      const msg = errMsg(err);
      if (open) setError(msg);
      else onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await cancelJoinRequest(team.id);
      onChanged("cancelled");
    } catch (err) {
      onError?.(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (team.requestPending) {
    return (
      <Button size={size} variant="outline" loading={busy} onClick={cancel} title="Cancel your request">
        Requested · Cancel
      </Button>
    );
  }

  const label = team.hasCode ? "Join" : team.joinMode === "request" ? "Request to join" : "Join";

  return (
    <>
      <Button
        size={size}
        loading={busy && !open}
        onClick={() => (team.hasCode ? setOpen(true) : submit())}
      >
        {team.hasCode && <KeyRound className="h-4 w-4" />}
        {label}
      </Button>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Join ${team.name}`}
        icon={<Users className="h-4 w-4" />}
        className="max-w-sm"
      >
        <form
          className="flex flex-col gap-3 px-2 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) submit(code.trim());
          }}
        >
          <Input
            label="Entry code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={16}
            autoComplete="off"
            autoFocus
            error={error || undefined}
            hint={
              team.joinMode === "request"
                ? "Have the code? You'll join straight away."
                : "This team needs a code to join."
            }
          />
          <Button type="submit" loading={busy} disabled={!code.trim()} fullWidth>
            Join with code
          </Button>
          {team.joinMode === "request" && (
            <Button type="button" variant="ghost" disabled={busy} fullWidth onClick={() => submit()}>
              No code? Request to join
            </Button>
          )}
        </form>
      </Modal>
    </>
  );
}

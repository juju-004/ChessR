import { useState } from "react";
import { Modal } from "./ui/Modal.js";
import { Button } from "./ui/index.js";
import { submitReport, type ReportReason } from "../api/reports.js";
import { ApiRequestError } from "../api/http.js";
import { useNotify } from "../contexts/NotificationContext.js";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "cheating", label: "Cheating (engine use, etc.)" },
  { value: "sandbagging", label: "Sandbagging / deliberately losing" },
  { value: "harassment", label: "Harassment or abusive chat" },
  { value: "payment_dispute", label: "Wager / payment dispute" },
  { value: "other", label: "Other" },
];

/** Accepts either a bare join code ("AB12CD") or a full game URL
 *  ("https://chessr.app/game/AB12CD", "/game/ab12cd", with or without a
 *  trailing slash/query string) and returns just the code. Falls back to
 *  treating the whole input as a code if it doesn't look like a URL, so a
 *  typo'd/partial paste doesn't just silently disappear. */
function extractGameCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/game\/([a-zA-Z0-9]+)/);
  if (match) return match[1].toUpperCase();
  return trimmed.toUpperCase();
}

export interface ReportUserModalProps {
  open: boolean;
  onClose: () => void;
  username: string;
}

export function ReportUserModal({ open, onClose, username }: ReportUserModalProps) {
  const { notify } = useNotify();
  const [reason, setReason] = useState<ReportReason>("cheating");
  const [gameCode, setGameCode] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setReason("cheating");
    setGameCode("");
    setDescription("");
    setError("");
  }

  async function handleSubmit() {
    if (description.trim().length < 10) {
      setError("Please give a few more details (at least 10 characters).");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await submitReport({
        reportedUsername: username,
        reason,
        description: description.trim(),
        gameCode: gameCode.trim() ? extractGameCode(gameCode) : undefined,
      });
      notify(`Report submitted. Our team will review it.`, [], 4000);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not submit report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={`Report ${username}`}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-base-content/60">
          Reports are reviewed by our team. If this involves a specific game,
          include its code below so we can pull it up directly. The
          account's withdrawals are put on hold automatically while we look
          into it.
        </p>

        <div>
          <label htmlFor="report-reason" className="mb-2 block text-sm font-medium text-base-content/80">
            Reason
          </label>
          <select
            id="report-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason)}
            className="w-full rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="report-game-code" className="mb-2 block text-sm font-medium text-base-content/80">
            Game code or URL <span className="text-base-content/40">(optional)</span>
          </label>
          <input
            id="report-game-code"
            type="text"
            value={gameCode}
            onChange={(e) => setGameCode(e.target.value.slice(0, 200))}
            placeholder="e.g. AB12CD or https://chessr.app/game/AB12CD"
            className="w-full rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
          />
        </div>

        <div>
          <label htmlFor="report-description" className="mb-2 block text-sm font-medium text-base-content/80">
            What happened?
          </label>
          <textarea
            id="report-description"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            rows={4}
            placeholder="Describe what you noticed: timing, specific moves, chat messages, etc."
            className="w-full resize-none rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
          />
          <p className="mt-1 text-right text-xs text-base-content/40">
            {description.length}/2000
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button
            variant="glass"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit report"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

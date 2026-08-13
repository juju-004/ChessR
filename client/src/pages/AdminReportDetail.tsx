import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, ShieldAlert, ShieldOff, ShieldCheck } from "lucide-react";
import {
  getReportDetail,
  updateReport,
  setUserReportingBlock,
  type AdminReportDetail as AdminReportDetailType,
  type ReportStatus,
} from "../api/admin.js";
import { Card, Badge, Spinner, Button } from "../components/ui/index.js";

const STATUS_OPTIONS: ReportStatus[] = ["pending", "reviewing", "actioned", "dismissed"];

function formatMs(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AdminReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<AdminReportDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ReportStatus>("pending");
  const [notes, setNotes] = useState("");
  const [clearBlock, setClearBlock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingReportAccess, setTogglingReportAccess] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getReportDetail(id)
      .then((r) => {
        setReport(r);
        setStatus(r.status);
        setNotes(r.reviewNotes ?? "");
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    try {
      await updateReport(id, { status, reviewNotes: notes, clearWithdrawalBlock: clearBlock });
      const refreshed = await getReportDetail(id);
      setReport(refreshed);
      setClearBlock(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleReportAccess() {
    if (!report?.reporter) return;
    setTogglingReportAccess(true);
    try {
      await setUserReportingBlock(report.reporter.username, !report.reporter.reportingBlocked);
      if (id) setReport(await getReportDetail(id));
    } finally {
      setTogglingReportAccess(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

  if (!report) {
    return <p className="p-6 text-base-content/60">Report not found.</p>;
  }

  const game = report.game;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <button
        onClick={() => navigate("/admin")}
        className="mb-4 flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content"
      >
        <ArrowLeft className="h-4 w-4" /> Back to queue
      </button>

      <Card variant="solid" className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-base-content">
            Report against{" "}
            <Link
              to={`/profile/${report.reportedUser?.username}`}
              target="_blank"
              className="text-(--primary) hover:underline"
            >
              {report.reportedUser?.username ?? "Unknown user"}
            </Link>
          </h1>
          {report.reportedUser?.withdrawalBlocked && (
            <Badge variant="error" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Withdrawals blocked
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-base-content/40">
          Filed by {report.reporter?.username ?? "unknown"} ·{" "}
          {new Date(report.createdAt).toLocaleString()} · reason:{" "}
          {report.reason.replace(/_/g, " ")}
        </p>
        <p className="mt-3 text-sm text-base-content/80">{report.description}</p>

        {report.reporter && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-base-300/60 pt-3">
            <p className="text-xs text-base-content/50">
              {report.reporter.reportingBlocked
                ? `${report.reporter.username} is currently blocked from filing new reports.`
                : `Bogus or bad-faith report? You can restrict ${report.reporter.username} from filing more.`}
            </p>
            <Button
              variant={report.reporter.reportingBlocked ? "glass" : "danger"}
              size="sm"
              onClick={handleToggleReportAccess}
              disabled={togglingReportAccess}
            >
              {report.reporter.reportingBlocked ? (
                <>
                  <ShieldCheck className="h-4 w-4" /> Restore report access
                </>
              ) : (
                <>
                  <ShieldOff className="h-4 w-4" /> Block from reporting
                </>
              )}
            </Button>
          </div>
        )}
      </Card>

      {report.gameCode && !game && (
        <Card variant="solid" className="mb-4 text-sm text-base-content/60">
          No game found for code <span className="font-mono">{report.gameCode}</span>.
        </Card>
      )}

      {game && (
        <Card variant="solid" className="mb-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-base-content">
              Game {game.joinCode}
            </h2>
            <Link to={`/game/${game.joinCode}`} target="_blank">
              <Button variant="glass" size="sm">
                Open game
              </Button>
            </Link>
          </div>
          <p className="text-sm text-base-content/70">
            {game.white?.username ?? "?"} vs {game.black?.username ?? "?"} ·{" "}
            {game.moves.length} moves ·{" "}
            {game.result ? `${game.result} (${game.endReason?.replace(/_/g, " ")})` : game.status}
          </p>

          {game.suspicion.some((s) => s.signals.length > 0) ? (
            <div className="mt-3 space-y-2">
              {game.suspicion
                .filter((s) => s.signals.length > 0)
                .map((s) => (
                  <div
                    key={s.side}
                    className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
                  >
                    <p className="flex items-center gap-1.5 font-semibold text-amber-500">
                      <ShieldAlert className="h-4 w-4" />
                      {s.side === "white" ? game.white?.username : game.black?.username} — worth
                      a look (score {s.score}/100)
                    </p>
                    <ul className="mt-1.5 list-disc pl-5 text-base-content/70">
                      {s.signals.map((sig, i) => (
                        <li key={i}>{sig.detail}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              <p className="text-xs text-base-content/40">
                Heuristic timing signal only — not a verdict. Review the moves
                yourself before acting on it.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-base-content/40">
              No timing anomalies flagged automatically — doesn't rule out
              cheating, just nothing stood out from move timing alone.
            </p>
          )}

          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase text-base-content/40">
              Move list
            </p>
            <div className="max-h-48 overflow-y-auto rounded-lg bg-base-100/60 p-2 font-mono text-xs">
              {game.moves.map((m, i) => {
                const prev = game.moves[i - 1];
                const thinkMs = prev ? m.timestampMs - prev.timestampMs : null;
                return (
                  <span key={i} className="mr-2 inline-block">
                    {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ""} {m.san}
                    {thinkMs !== null && (
                      <span className="text-base-content/30"> ({formatMs(thinkMs)})</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <Card variant="solid">
        <h2 className="mb-3 text-base font-semibold text-base-content">Review</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                status === s
                  ? "bg-(--primary) text-white"
                  : "bg-base-200 text-base-content/60 hover:bg-base-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Notes for the record (optional)"
          className="w-full resize-none rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
        />
        {report.reportedUser?.withdrawalBlocked && (
          <label className="mt-3 flex items-center gap-2 text-sm text-base-content/70">
            <input
              type="checkbox"
              checked={clearBlock}
              onChange={(e) => setClearBlock(e.target.checked)}
            />
            Clear withdrawal block for {report.reportedUser.username}
          </label>
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save review"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Landmark, Copy, Check, CheckCircle2, XCircle } from "lucide-react";
import {
  listWithdrawals,
  resolveWithdrawal,
  type AdminWithdrawal,
  type TxStatus,
  type WithdrawalListResponse,
} from "../../api/admin.js";
import { Card, Badge, Spinner, Button } from "../ui/index.js";

const FILTERS: (TxStatus | "all")[] = ["pending", "success", "failed", "all"];

const FILTER_LABEL: Record<TxStatus | "all", string> = {
  pending: "Pending",
  success: "Paid",
  failed: "Declined",
  all: "All",
};

const statusVariant: Record<TxStatus, "warning" | "success" | "error"> = {
  pending: "warning",
  success: "success",
  failed: "error",
};

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString()}`;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
      className="inline-flex items-center text-base-content/40 hover:text-base-content"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function AdminWithdrawals() {
  const [filter, setFilter] = useState<TxStatus | "all">("pending");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<WithdrawalListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError("");
    listWithdrawals(filter, page)
      .then(setData)
      .catch(() => setError("Could not load withdrawals"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [filter, page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handle(w: AdminWithdrawal, action: "paid" | "decline") {
    let note: string | undefined;
    if (action === "paid") {
      const ok = window.confirm(
        `Confirm you've sent ${naira(w.amountKobo)} to ${w.accountName ?? "(name not verified)"} (${w.accountNumber}).\n\nThis marks the request as paid.`,
      );
      if (!ok) return;
    } else {
      const reason = window.prompt(
        `Decline this withdrawal and return ${w.tokens} R Coins to @${w.user?.username}?\n\nOptional reason (shown to the user):`,
        "",
      );
      if (reason === null) return; // cancelled
      note = reason.trim() || undefined;
    }

    setBusyId(w.id);
    setError("");
    try {
      await resolveWithdrawal(w.id, action, note);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that withdrawal");
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Card variant="solid">
            <p className="text-xs text-base-content/50">Awaiting payout</p>
            <p className="text-lg font-bold text-amber-500">
              {naira(data.summary.pendingKobo)}
            </p>
            <p className="text-xs text-base-content/40">
              {data.summary.pendingCount} request{data.summary.pendingCount === 1 ? "" : "s"}
            </p>
          </Card>
          <Card variant="solid">
            <p className="text-xs text-base-content/50">Paid out</p>
            <p className="text-lg font-bold text-base-content">{naira(data.summary.paidKobo)}</p>
            <p className="text-xs text-base-content/40">{data.summary.paidCount} paid</p>
          </Card>
          <Card variant="solid">
            <p className="text-xs text-base-content/50">Declined</p>
            <p className="text-lg font-bold text-base-content">{data.summary.declinedCount}</p>
            <p className="text-xs text-base-content/40">refunded to users</p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === f
                  ? "bg-(--primary)/15 text-(--primary)"
                  : "bg-base-300 text-base-content/60 hover:text-base-content"
              }`}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <Button variant="glass" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-10">
          <Spinner className="text-base-content/40" />
        </div>
      )}

      {error && (
        <Card variant="solid" className="border-red-900/50 bg-red-950/20 text-red-300">
          {error}
        </Card>
      )}

      {!loading && data && data.withdrawals.length === 0 && (
        <p className="py-10 text-center text-sm text-base-content/50">
          {filter === "pending" ? "No withdrawals waiting. All caught up." : "Nothing here."}
        </p>
      )}

      <div className="space-y-3">
        {data?.withdrawals.map((w) => (
          <Card key={w.id} variant="solid" className="space-y-2.5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold break-all text-base-content">
                  @{w.user?.username ?? "(deleted user)"}
                </p>
                {w.user?.email && (
                  <p className="text-xs break-all text-base-content/40">{w.user.email}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-base-content">{naira(w.amountKobo)}</span>
                <Badge variant={statusVariant[w.status]} className="uppercase">
                  {w.status === "success" ? "paid" : w.status === "failed" ? "declined" : "pending"}
                </Badge>
              </div>
            </div>

            <div className="rounded-lg bg-base-100/60 px-3 py-2 text-xs text-base-content/70">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Landmark className="h-3.5 w-3.5 shrink-0 text-base-content/40" />
                <span>{w.bankName ?? `Bank code ${w.bankCode}`}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-sm text-base-content">{w.accountNumber}</span>
                {w.accountNumber && <CopyButton value={w.accountNumber} label="Copy account number" />}
                {w.accountName ? (
                  <span>· {w.accountName}</span>
                ) : (
                  <span className="text-amber-500">· name not verified, double-check before sending</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-base-content/40">
              <span>
                {w.tokens} R Coins · {w.reference}
              </span>
              <span>{new Date(w.createdAt).toLocaleString()}</span>
            </div>

            {w.status !== "pending" && (
              <p className="text-xs text-base-content/50">
                {w.status === "success" ? "Paid" : "Declined"}
                {w.resolvedAt ? ` on ${new Date(w.resolvedAt).toLocaleString()}` : ""}
                {w.adminNote ? ` · ${w.adminNote}` : ""}
                {w.failureReason ? ` · ${w.failureReason}` : ""}
              </p>
            )}

            {w.status === "pending" && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => handle(w, "paid")}
                  disabled={busyId === w.id}
                  loading={busyId === w.id}
                >
                  <CheckCircle2 className="h-4 w-4" /> Mark as paid
                </Button>
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => handle(w, "decline")}
                  disabled={busyId === w.id}
                >
                  <XCircle className="h-4 w-4" /> Decline &amp; refund
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 pt-2">
          <Button variant="glass" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-xs text-base-content/50">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            variant="glass"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

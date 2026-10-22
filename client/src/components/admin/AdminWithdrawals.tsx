import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Landmark,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import {
  listWithdrawals,
  getWithdrawal,
  resolveWithdrawal,
  type AdminWithdrawal,
  type TxStatus,
  type WithdrawalListResponse,
} from "../../api/admin.js";
import { ApiRequestError } from "../../api/http.js";
import { Card, Badge, CenteredSpinner, Button } from "../ui/index.js";

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

/**
 * One withdrawal with its Paid / Decline actions. Shared by the list and by
 * the direct-link page the Telegram alert points at, so approving looks and
 * behaves the same either way. After any action (or a failed one, e.g. the
 * other admin already handled it) it calls onChanged so the parent reloads.
 */
function WithdrawalCard({
  w,
  onChanged,
  linkToPage,
}: {
  w: AdminWithdrawal;
  onChanged: () => void;
  linkToPage?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "paid" | "decline") {
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

    setBusy(true);
    setError("");
    try {
      await resolveWithdrawal(w.id, action, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that withdrawal");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <Card variant="solid" className="space-y-2.5 text-sm">
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
          <CopyButton value={String(w.amountKobo / 100)} label="Copy amount" />
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

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {w.status === "pending" && (
          <>
            <Button size="sm" onClick={() => act("paid")} disabled={busy} loading={busy}>
              <CheckCircle2 className="h-4 w-4" /> Mark as paid
            </Button>
            <Button variant="glass" size="sm" onClick={() => act("decline")} disabled={busy}>
              <XCircle className="h-4 w-4" /> Decline &amp; refund
            </Button>
          </>
        )}
        {linkToPage && (
          <Link
            to={`/admin/withdrawals/${w.id}`}
            className="ml-auto inline-flex items-center gap-1 text-xs text-base-content/50 hover:text-base-content"
          >
            Open <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </Card>
  );
}

export function AdminWithdrawals() {
  // Filter and page live in the URL (?status=pending&page=2) so a filtered
  // view is itself a link; "pending" is the default and keeps the URL clean.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get("status");
  const filter: TxStatus | "all" = FILTERS.includes(rawStatus as TxStatus | "all")
    ? (rawStatus as TxStatus | "all")
    : "pending";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [data, setData] = useState<WithdrawalListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function setView(nextFilter: TxStatus | "all", nextPage: number) {
    const next = new URLSearchParams();
    if (nextFilter !== "pending") next.set("status", nextFilter);
    if (nextPage > 1) next.set("page", String(nextPage));
    setSearchParams(next);
  }

  function load() {
    setLoading(true);
    setError("");
    listWithdrawals(filter, page)
      .then(setData)
      .catch(() => setError("Could not load withdrawals"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [filter, page]); // eslint-disable-line react-hooks/exhaustive-deps

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
              onClick={() => setView(f, 1)}
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

      {loading && <CenteredSpinner className="py-10" />}

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
          <WithdrawalCard key={w.id} w={w} onChanged={load} linkToPage />
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 pt-2">
          <Button variant="glass" size="sm" disabled={page <= 1} onClick={() => setView(filter, page - 1)}>
            Previous
          </Button>
          <span className="text-xs text-base-content/50">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            variant="glass"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setView(filter, page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * /admin/withdrawals/:id, the page the Telegram alert links to: just this one
 * request, with the bank details and Paid / Decline buttons in front of you.
 * If someone else already handled it, it shows the result instead of buttons.
 */
export function AdminWithdrawalDetail() {
  const { id } = useParams<{ id: string }>();
  const [w, setW] = useState<AdminWithdrawal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    if (!id) return;
    setError("");
    getWithdrawal(id)
      .then(setW)
      .catch((err) =>
        setError(
          err instanceof ApiRequestError && err.status === 404
            ? "That withdrawal doesn't exist."
            : "Could not load this withdrawal",
        ),
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <Link
        to="/admin/withdrawals"
        className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content"
      >
        <ArrowLeft className="h-4 w-4" /> All withdrawals
      </Link>

      {loading && <CenteredSpinner className="py-10" />}

      {error && (
        <Card variant="solid" className="border-red-900/50 bg-red-950/20 text-red-300">
          {error}
        </Card>
      )}

      {w && <WithdrawalCard w={w} onChanged={load} />}
    </div>
  );
}

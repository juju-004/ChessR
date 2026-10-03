import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  listDeposits,
  type DepositListResponse,
  type TxStatus,
} from "../../api/admin.js";
import { Card, Badge, Spinner, Button } from "../ui/index.js";

const FILTERS: (TxStatus | "all")[] = ["all", "success", "pending", "failed"];

const FILTER_LABEL: Record<TxStatus | "all", string> = {
  all: "All",
  success: "Successful",
  pending: "Pending",
  failed: "Failed",
};

const statusVariant: Record<TxStatus, "warning" | "success" | "error"> = {
  pending: "warning",
  success: "success",
  failed: "error",
};

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString()}`;

export function AdminDeposits() {
  const [filter, setFilter] = useState<TxStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState(""); // debounced value actually sent
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DepositListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  function load() {
    setLoading(true);
    setError("");
    listDeposits(filter, q || undefined, page)
      .then(setData)
      .catch(() => setError("Could not load deposits"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [filter, q, page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {data && (
        <>
          <Card variant="solid" className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm text-(--primary)">Total received via Paystack</p>
              <p className="text-xl font-bold text-base-content sm:text-2xl">
                {naira(data.summary.totalReceivedKobo)}
              </p>
            </div>
            <div className="text-right text-xs text-base-content/50">
              <p>{data.summary.successCount} successful deposits</p>
              <p>{data.summary.totalTokensSold.toLocaleString()} R Coins sold</p>
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Card variant="solid">
              <p className="text-xs text-base-content/50">This month</p>
              <p className="text-lg font-bold text-base-content">
                {naira(data.summary.thisMonthKobo)}
              </p>
            </Card>
            <Card variant="solid">
              <p className="text-xs text-base-content/50">Pending</p>
              <p className="text-lg font-bold text-amber-500">{data.summary.pendingCount}</p>
            </Card>
            <Card variant="solid">
              <p className="text-xs text-base-content/50">Failed</p>
              <p className="text-lg font-bold text-red-400">{data.summary.failedCount}</p>
            </Card>
          </div>
        </>
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

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-base-content/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username or reference…"
          className="w-full rounded-xl border border-base-300 bg-base-100/60 py-2 pr-3 pl-9 text-sm text-base-content outline-none focus:border-(--primary)"
        />
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

      {!loading && data && data.deposits.length === 0 && (
        <p className="py-10 text-center text-sm text-base-content/50">No deposits found.</p>
      )}

      <div className="space-y-2">
        {data?.deposits.map((d) => (
          <Card
            key={d.id}
            variant="solid"
            className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold break-all text-base-content">
                @{d.user?.username ?? "(deleted user)"}
              </p>
              <p className="text-xs break-all text-base-content/40">
                {d.reference} · {d.tokens.toLocaleString()} R Coins
              </p>
              {d.status === "failed" && d.failureReason && (
                <p className="text-xs text-red-400">{d.failureReason}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:justify-end">
              <span className="font-bold text-base-content">{naira(d.amountKobo)}</span>
              <Badge variant={statusVariant[d.status]} className="uppercase">
                {d.status}
              </Badge>
              <span className="text-xs text-base-content/40">
                {new Date(d.createdAt).toLocaleString()}
              </span>
            </div>
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

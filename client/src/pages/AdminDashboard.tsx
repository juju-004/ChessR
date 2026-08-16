import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  LogOut,
  AlertTriangle,
  Swords,
  Trophy,
  Gamepad2,
} from "lucide-react";
import {
  listReports,
  getRevenueSummary,
  type AdminReportListItem,
  type ReportStatus,
  type RevenueSummary,
  type RevenueSource,
} from "../api/admin.js";
import { clearAdminToken } from "../api/adminAuthStore.js";
import {
  Card,
  Badge,
  Spinner,
  Button,
  Tabs,
  RCoinAmount,
} from "../components/ui/index.js";

const STATUS_FILTERS: (ReportStatus | "all")[] = [
  "pending",
  "reviewing",
  "actioned",
  "dismissed",
  "all",
];

const statusVariant: Record<
  ReportStatus,
  "warning" | "neutral" | "success" | "error"
> = {
  pending: "warning",
  reviewing: "neutral",
  actioned: "success",
  dismissed: "error",
};

const SOURCE_LABEL: Record<RevenueSource, string> = {
  game: "Games",
  cage_match: "Cage matches",
  tournament: "Tournaments",
};

const SOURCE_ICON: Record<RevenueSource, typeof Gamepad2> = {
  game: Gamepad2,
  cage_match: Swords,
  tournament: Trophy,
};

export function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"reports" | "revenue">("reports");
  const [status, setStatus] = useState<ReportStatus | "all">("pending");
  const [reports, setReports] = useState<AdminReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueError, setRevenueError] = useState("");
  const [revenuePage, setRevenuePage] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError("");
    listReports(status)
      .then(setReports)
      .catch(() => setError("Could not load reports"))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    if (tab !== "revenue") return;
    setRevenueLoading(true);
    setRevenueError("");
    getRevenueSummary(revenuePage)
      .then(setRevenue)
      .catch(() => setRevenueError("Could not load revenue"))
      .finally(() => setRevenueLoading(false));
  }, [tab, revenuePage]);

  function handleLogout() {
    clearAdminToken();
    navigate("/admin/login", { replace: true });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-base-content">
          <ShieldCheck className="h-5 w-5 text-(--primary)" />
          <h1 className="text-lg font-semibold">Report review</h1>
        </div>
        <Button variant="glass" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>

      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as "reports" | "revenue")}
          items={[
            { value: "reports", label: "Reports" },
            { value: "revenue", label: "Revenue" },
          ]}
        />
      </div>

      {tab === "reports" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((s) => (
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

          {loading && (
            <div className="flex justify-center py-10">
              <Spinner className="text-base-content/40" />
            </div>
          )}

          {error && (
            <Card
              variant="solid"
              className="border-red-900/50 bg-red-950/20 text-red-300"
            >
              {error}
            </Card>
          )}

          {!loading && !error && reports.length === 0 && (
            <p className="py-10 text-center text-sm text-base-content/50">
              No {status !== "all" ? status : ""} reports.
            </p>
          )}

          <div className="space-y-2">
            {reports.map((r) => (
              <Link key={r.id} to={`/admin/reports/${r.id}`}>
                <Card variant="solid" interactive className="text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-base-content">
                        {r.reportedUser?.username ?? "Unknown user"}
                      </span>
                      <span className="text-base-content/40">reported by</span>
                      <span className="text-base-content/70">
                        {r.reporter?.username ?? "Unknown"}
                      </span>
                      {r.reporter?.reportingBlocked && (
                        <Badge variant="neutral" className="gap-1">
                          Reporter blocked
                        </Badge>
                      )}
                      {r.reportedUser?.withdrawalBlocked && (
                        <Badge variant="error" className="gap-1">
                          <AlertTriangle className="h-3 w-3" /> Withdrawals
                          blocked
                        </Badge>
                      )}
                    </div>
                    <Badge
                      variant={statusVariant[r.status]}
                      className="capitalize"
                    >
                      {r.status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-base-content/60">
                    {r.description}
                  </p>
                  <p className="mt-1.5 text-xs text-base-content/40">
                    {r.reason.replace(/_/g, " ")}
                    {r.gameCode ? ` · game ${r.gameCode}` : ""} ·{" "}
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {revenueLoading && (
            <div className="flex justify-center py-10">
              <Spinner className="text-base-content/40" />
            </div>
          )}

          {revenueError && (
            <Card
              variant="solid"
              className="border-red-900/50 bg-red-950/20 text-red-300"
            >
              {revenueError}
            </Card>
          )}

          {!revenueLoading && !revenueError && revenue && (
            <>
              {/* Total admin wallet balance — the running sum of every rake
               *  cut ever recorded (see PlatformRevenue.ts on the server).
               *  Not a separately-maintained counter, so it can never drift
               *  out of sync with the ledger below it. */}
              <Card
                variant="solid"
                className="flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-(--primary)">
                    Admin wallet balance
                  </p>
                  <p className="text-2xl font-bold text-base-content">
                    <RCoinAmount
                      value={revenue.balanceTokens}
                      size={22}
                      className="text-2xl font-bold"
                    />
                  </p>
                </div>
                <Badge variant="neutral">{revenue.ratePercent}% rake</Badge>
              </Card>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(SOURCE_LABEL) as RevenueSource[]).map(
                  (source) => {
                    const Icon = SOURCE_ICON[source];
                    const s = revenue.bySource[source];
                    return (
                      <Card
                        key={source}
                        variant="solid"
                        className="flex items-center gap-3"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--primary)/15 text-(--primary)">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-base-content/50">
                            {SOURCE_LABEL[source]}
                          </p>
                          <p className="text-sm font-semibold text-base-content">
                            <RCoinAmount value={s.tokens} size={14} /> ·{" "}
                            {s.count} {s.count === 1 ? "cut" : "cuts"}
                          </p>
                        </div>
                      </Card>
                    );
                  },
                )}
              </div>

              {revenue.entries.length === 0 ? (
                <p className="py-10 text-center text-sm text-base-content/50">
                  No rake collected yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {revenue.entries.map((e) => {
                    const Icon = SOURCE_ICON[e.source];
                    return (
                      <Card
                        key={e.id}
                        variant="solid"
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2 text-base-content/70">
                          <Icon className="h-4 w-4 text-base-content/40" />
                          <span className="capitalize">
                            {SOURCE_LABEL[e.source]}
                          </span>
                          <span className="text-base-content/40">
                            · {e.ratePercent}% of{" "}
                            <RCoinAmount value={e.grossPotTokens} size={12} />
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-base-content">
                            <RCoinAmount value={e.tokens} size={14} />
                          </span>
                          <span className="text-xs text-base-content/40">
                            {new Date(e.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              {revenue.totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={revenuePage <= 1}
                    onClick={() => setRevenuePage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-base-content/50">
                    Page {revenue.page} of {revenue.totalPages}
                  </span>
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={revenuePage >= revenue.totalPages}
                    onClick={() => setRevenuePage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

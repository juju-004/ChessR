import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, LogOut, AlertTriangle } from "lucide-react";
import { listReports, type AdminReportListItem, type ReportStatus } from "../api/admin.js";
import { clearAdminToken } from "../api/adminAuthStore.js";
import { Card, Badge, Spinner, Button } from "../components/ui/index.js";

const STATUS_FILTERS: (ReportStatus | "all")[] = [
  "pending",
  "reviewing",
  "actioned",
  "dismissed",
  "all",
];

const statusVariant: Record<ReportStatus, "warning" | "neutral" | "success" | "error"> = {
  pending: "warning",
  reviewing: "neutral",
  actioned: "success",
  dismissed: "error",
};

export function AdminDashboard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReportStatus | "all">("pending");
  const [reports, setReports] = useState<AdminReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    listReports(status)
      .then(setReports)
      .catch(() => setError("Could not load reports"))
      .finally(() => setLoading(false));
  }, [status]);

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
        <Card variant="solid" className="border-red-900/50 bg-red-950/20 text-red-300">
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
                      <AlertTriangle className="h-3 w-3" /> Withdrawals blocked
                    </Badge>
                  )}
                </div>
                <Badge variant={statusVariant[r.status]} className="capitalize">
                  {r.status}
                </Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-base-content/60">{r.description}</p>
              <p className="mt-1.5 text-xs text-base-content/40">
                {r.reason.replace(/_/g, " ")}
                {r.gameCode ? ` · game ${r.gameCode}` : ""} ·{" "}
                {new Date(r.createdAt).toLocaleString()}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import {
  listOrganizations,
  reviewOrganization,
  type AdminOrganization,
  type AdminOrgStatus,
} from "../../api/admin.js";
import { OrgBadge } from "../organizations/OrgBadge.js";
import { Card, Badge, Spinner, Button } from "../ui/index.js";

const FILTERS: (AdminOrgStatus | "all")[] = ["pending", "approved", "rejected", "all"];

const statusVariant: Record<AdminOrgStatus, "warning" | "success" | "error"> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
};

function OrgCard({
  org,
  onChanged,
}: {
  org: AdminOrganization;
  onChanged: (o: AdminOrganization) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: "approve" | "reject" | "revoke") {
    setBusy(true);
    setError("");
    try {
      const r = await reviewOrganization(org.id, {
        action,
        note: action === "approve" ? undefined : note.trim() || undefined,
      });
      onChanged({ ...r.organization, owner: org.owner });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that organisation");
    } finally {
      setBusy(false);
    }
  }

  const waDigits = org.whatsapp.replace(/\D/g, "");

  return (
    <Card variant="solid" className="space-y-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="font-semibold break-words text-base-content">
              {org.status === "approved" ? <OrgBadge name={org.name} /> : org.name}
            </div>
            <div className="text-xs text-base-content/50">
              Owner: <span className="text-base-content/70">{org.owner?.username ?? "Unknown"}</span> ·{" "}
              {new Date(org.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
        <Badge variant={statusVariant[org.status]} className="capitalize">
          {org.status}
        </Badge>
      </div>

      <a
        href={`https://wa.me/${waDigits}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-(--primary) hover:underline"
      >
        <MessageCircle className="h-4 w-4" /> {org.whatsapp}
      </a>

      {org.status === "rejected" && org.reviewNote && (
        <p className="text-xs text-base-content/50">Note: {org.reviewNote}</p>
      )}

      {org.status === "pending" && (
        <div className="space-y-3 border-t border-base-300 pt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason (shown to the user if you reject)"
            maxLength={300}
            className="w-full rounded-xl border border-base-300 bg-base-100/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
          />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => act("approve")}>
              Approve
            </Button>
            <Button variant="glass" size="sm" disabled={busy} onClick={() => act("reject")}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {org.status === "approved" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-base-300 pt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for revoking (optional)"
            maxLength={300}
            className="min-w-0 flex-1 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
          />
          <Button variant="glass" size="sm" disabled={busy} onClick={() => act("revoke")}>
            Revoke
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </Card>
  );
}

export function AdminOrganizations() {
  const [filter, setFilter] = useState<AdminOrgStatus | "all">("pending");
  const [orgs, setOrgs] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    listOrganizations(filter === "all" ? undefined : filter)
      .then((r) => setOrgs(r.organizations))
      .catch(() => setError("Could not load organisations"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleChanged(updated: AdminOrganization) {
    setOrgs((prev) =>
      filter === "all"
        ? prev.map((o) => (o.id === updated.id ? updated : o))
        : prev.filter((o) => o.id !== updated.id),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-(--primary) text-white"
                  : "bg-base-200 text-base-content/60 hover:bg-base-300"
              }`}
            >
              {f}
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
      {!loading && !error && orgs.length === 0 && (
        <p className="py-10 text-center text-sm text-base-content/50">
          No {filter !== "all" ? filter : ""} organisations.
        </p>
      )}
      <div className="space-y-2">
        {orgs.map((o) => (
          <OrgCard key={o.id} org={o} onChanged={handleChanged} />
        ))}
      </div>
    </div>
  );
}

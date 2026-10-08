import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  Building2,
  Check,
  Clock,
  Phone,
  Swords,
  Layers,
  XCircle,
} from "lucide-react";
import {
  getMyOrganization,
  requestOrganization,
  type MyOrganization,
} from "../api/organizations.js";
import { ApiRequestError } from "../api/http.js";
import { OrgBadge } from "../components/organizations/OrgBadge.js";
import { cn } from "@/lib/cn.js";
import { Page, Card, Input, Button, Spinner } from "../components/ui/index.js";

const PERKS = [
  {
    icon: BadgeCheck,
    title: "Verified badge",
    body: "A badge with your organisation's name on your profile.",
  },
  {
    icon: Swords,
    title: "Team battles",
    body: "Create team battle tournaments, Swiss or Arena.",
  },
  {
    icon: Layers,
    title: "League battle",
    body: "Organize league battles",
  },
];

function Steps({ current }: { current: 0 | 1 | 2 }) {
  const steps = ["Submitted", "Under review", "Approved"];
  return (
    <ol className="flex items-center">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                  done && "bg-emerald-500 text-white",
                  active && "bg-(--primary) text-white",
                  !done && !active && "bg-base-300 text-base-content/40",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  active || done ? "text-base-content" : "text-base-content/40",
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "mx-2 mb-5 h-0.5 flex-1 rounded",
                  done ? "bg-emerald-500" : "bg-base-300",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function OrganizationRequest() {
  const [org, setOrg] = useState<MyOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [reapplying, setReapplying] = useState(false);

  useEffect(() => {
    getMyOrganization()
      .then((r) => setOrg(r.organization))
      .catch(() => setError("Could not load your organisation status"))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2)
      return setError("Enter your organisation's name.");
    if (whatsapp.replace(/\D/g, "").length < 8)
      return setError("Enter a valid WhatsApp number with the country code.");
    setSubmitting(true);
    try {
      const r = await requestOrganization({
        name: name.trim(),
        whatsapp: whatsapp.trim(),
      });
      setOrg(r.organization);
      setReapplying(false);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not send your request, try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = !org || (org.status === "rejected" && reapplying);

  return (
    <Page title="Organisation request" back>
      <div className="mx-auto max-w-2xl space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="text-base-content/40" />
          </div>
        ) : (
          <>
            {/* Intro */}
            <Card variant="solid" className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl gradient-brand text-white shadow-sm shadow-(--primary)/25">
                  <Building2 className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-base-content">
                    Run a club, school or community?
                  </h2>
                  <p className="text-sm text-base-content/60">
                    Become a verified organisation on Chessr.
                  </p>
                </div>
              </div>
              <ul className="space-y-2.5">
                {PERKS.map((p) => (
                  <li key={p.title} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                      <p.icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm">
                      <span className="font-medium text-base-content">
                        {p.title}
                      </span>
                      <span className="text-base-content/60"> · {p.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {org?.status === "pending" && (
              <Card variant="solid" className="space-y-4">
                <Steps current={1} />
                <div className="rounded-xl bg-base-200/60 p-3 text-sm text-base-content/70">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-500">
                    <Clock className="h-4 w-4" /> Request under review
                  </div>
                  We'll contact{" "}
                  <strong className="text-base-content">{org.name}</strong> on
                  WhatsApp ({org.whatsapp}). You'll get a notification here once
                  it's decided.
                </div>
              </Card>
            )}

            {org?.status === "approved" && (
              <Card variant="solid" className="space-y-4">
                <Steps current={2} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <OrgBadge name={org.name} />
                    <p className="text-xs text-base-content/50">
                      Shown on your profile.
                    </p>
                  </div>
                  <Link to="/tournaments/new?battle=1">
                    <Button variant="secondary" size="sm">
                      <Swords className="h-4 w-4" /> Create a team battle
                    </Button>
                  </Link>
                </div>
              </Card>
            )}

            {org?.status === "rejected" && !reapplying && (
              <Card variant="solid" className="space-y-3">
                <div className="flex items-center gap-2 font-semibold text-red-400">
                  <XCircle className="h-5 w-5" /> Not approved
                </div>
                {org.reviewNote && (
                  <p className="rounded-xl bg-base-200/60 p-3 text-sm text-base-content/70">
                    {org.reviewNote}
                  </p>
                )}
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => {
                    setName(org.name);
                    setWhatsapp(org.whatsapp);
                    setReapplying(true);
                  }}
                >
                  Apply again
                </Button>
              </Card>
            )}

            {showForm && (
              <Card variant="solid">
                <form onSubmit={submit} className="space-y-4">
                  <div className="grid w-full grid-cols-1 items-start gap-4 md:grid-cols-2">
                    <Input
                      label="Organisation name"
                      leadingIcon={<Building2 className="h-4 w-4" />}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Lagos Chess Club"
                      maxLength={40}
                      required
                    />
                    <Input
                      label="WhatsApp phone number"
                      leadingIcon={<Phone className="h-4 w-4" />}
                      type="tel"
                      inputMode="tel"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      placeholder="+234 801 234 5678"
                      hint="Include the country code. We'll reach out here to verify you."
                      maxLength={24}
                      required
                    />
                  </div>
                  {error && (
                    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    variant="secondary"
                    fullWidth
                    disabled={submitting}
                  >
                    {submitting ? "Sending…" : "Submit request"}
                  </Button>
                </form>
              </Card>
            )}
            {!showForm && error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

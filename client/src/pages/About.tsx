import { Link } from "react-router-dom";
import {
  Swords,
  ShieldCheck,
  Trophy,
  Coins,
  Building2,
  ExternalLink,
} from "lucide-react";
import { Page } from "@/components/ui/Page.js";
import { Card } from "@/components/ui/Card.js";

// Set this to RabahTech's actual site before shipping, placeholder for
// now so the About page has somewhere real to point once it's ready.
const RABAHTECH_URL = "https://rabah-tech.onrender.com";

const PILLARS = [
  {
    icon: Swords,
    accent: "bg-blue-500/15 text-blue-400",
    title: "Real games, real stakes",
    body: "Every match runs on server-authoritative move validation, so what you see on the board is exactly what's recorded, no client can cheat the rules of chess itself.",
  },
  {
    icon: Coins,
    accent: "bg-amber-500/15 text-amber-400",
    title: "R Coin wagers",
    body: "Players stake R Coins on games, cage matches, and tournaments. Winners take the pot, minus a small platform fee, see our Terms of Service for the exact rate.",
  },
  {
    icon: Trophy,
    accent: "bg-rose-500/15 text-rose-400",
    title: "Multiple ways to compete",
    body: "One-off wagered games, multi-leg cage matches, and full tournaments (Swiss, Knockout, Round Robin) for players who want something longer-form.",
  },
  {
    icon: ShieldCheck,
    accent: "bg-emerald-500/15 text-emerald-400",
    title: "Fair play, enforced",
    body: "A reporting system and anti-cheat review process back every game, so a good-faith community stays that way.",
  },
];

export function About() {
  return (
    <Page
      title={
        <span className="flex justify-start items-center gap-3">
          About
          <img src="/logo.png" alt="Chessr" className="w-24 mb-1" />
        </span>
      }
      description="Who we are and what we're building."
      back
    >
      <div className="space-y-4">
        <Card variant="solid">
          <p className="text-sm leading-relaxed text-base-content/80">
            Chessr is a multiplayer chess platform built for players who want
            something on the line, real-time games, cage matches, and
            tournaments where R Coin wagers turn every move into a decision that
            matters. Under the hood, every game is validated server-side, so the
            result on the board is always the one that counts.
          </p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <Card key={p.title} variant="solid" className="flex flex-col gap-2">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full ${p.accent}`}
              >
                <p.icon className="h-5 w-5" />
              </span>
              <h2 className="text-sm font-semibold text-base-content">
                {p.title}
              </h2>
              <p className="text-sm text-base-content/70">{p.body}</p>
            </Card>
          ))}
        </div>

        <Card variant="solid">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-base-content">
            <Building2 className="h-4 w-4 text-base-content/50" />
            Our companies
          </h2>
          <p className="mb-3 text-sm text-base-content/70">
            Chessr is a product of RabahTech, our parent company building
            real-money gaming and fintech products.
          </p>
          <a
            href={RABAHTECH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-(--primary) hover:underline"
          >
            Visit RabahTech
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Card>

        <Card variant="solid">
          <h2 className="mb-2 text-sm font-semibold text-base-content">
            Have questions?
          </h2>
          <p className="text-sm text-base-content/70">
            Read our{" "}
            <Link to="/terms" className="text-(--primary) hover:underline">
              Terms of Service
            </Link>{" "}
            for the full rules on wagers, the platform fee, deposits, and
            withdrawals.
          </p>
        </Card>
      </div>
    </Page>
  );
}

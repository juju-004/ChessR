import { FlaskConical } from "lucide-react";
import { Card } from "./ui/index.js";

/**
 * Shown on every page that touches R Coins (buying, withdrawing, wagering,
 * transaction history) while the platform isn't yet financially stable
 * enough to run full Paystack payout functionality. R Coins here are
 * test-mode only — nothing shown/wagered/bought is real money. Naira
 * tournament prize pools (see PrizePoolEditor's currency toggle) are a
 * separate, real-money flow disbursed manually over WhatsApp and are
 * deliberately NOT covered by this banner.
 *
 * Purely informational, same visual pattern as RestrictionBanner.tsx.
 */
export function TestModeBanner({ className = "" }: { className?: string }) {
  return (
    <Card
      variant="solid"
      className={`flex items-start gap-3 border-amber-500/30 bg-amber-500/10 ${className}`}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
        <FlaskConical className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-base-content">
          R Coins are test mode for now
        </p>
        <p className="mt-0.5 text-xs text-base-content/60">
          Balances, purchases, wagers, and withdrawals shown here aren't real
          money yet. We'll announce when that changes.
        </p>
      </div>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Trophy } from "lucide-react";
import { getPayoutAccount, type PayoutAccount } from "../../api/wallet.js";
import { ordinalSuffix, type Tournament } from "../../api/tournaments.js";
import { Card, Button } from "../ui/index.js";

/**
 * Shown on a finished naira-prize tournament's page, only to a player who
 * actually won a prize in it (see distributePrize / nairaWinners in
 * tournament.service.ts). Naira prizes are paid out manually by the team
 * to the winner's saved payout account, so this nudges the winner to add
 * those details if they haven't, and quietly confirms them if they have.
 * It's the on-page twin of the "You won ₦X" notification, for anyone who
 * missed or dismissed that.
 *
 * Layout: icon + text on one row, with the button stacked full-width under
 * the text on phones and sitting to the right from `sm` up. Every text
 * block has min-w-0 + break-words so a long tournament name or bank name
 * can never push the card wider than the screen.
 */
export function NairaWinnerBanner({
  tournament,
  myId,
}: {
  tournament: Tournament;
  myId: string | undefined;
}) {
  const win =
    myId &&
    tournament.status === "finished" &&
    tournament.prizePoolCurrency === "naira"
      ? (tournament.nairaWinners ?? []).find((w) => w.user === myId)
      : undefined;

  // undefined = still loading, null = nothing saved yet.
  const [account, setAccount] = useState<PayoutAccount | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!win) return;
    let cancelled = false;
    getPayoutAccount()
      .then((res) => {
        if (!cancelled) setAccount(res.payoutAccount);
      })
      // If the lookup fails, err on the side of asking: showing the
      // "add your details" prompt to someone who already did is a minor
      // annoyance, hiding it from someone who hasn't could cost a prize.
      .catch(() => {
        if (!cancelled) setAccount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [win?.rank, myId, tournament._id]);

  if (!win || account === undefined) return null;

  const prize = `₦${win.naira.toLocaleString()}`;
  const place = `${win.rank}${ordinalSuffix(win.rank)}`;

  if (account) {
    return (
      <Card
        variant="solid"
        className="flex flex-col gap-3 border-emerald-500/30 bg-emerald-500/10 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="wrap-break-word text-sm font-semibold text-base-content">
              You won {prize} for {place} place
            </p>
            <p className="mt-0.5 wrap-break-word text-xs text-base-content/60">
              Your payout account ({account.bankName} ••••
              {account.accountNumber.slice(-4)}) is on file. Our team will send
              your prize there by bank transfer.
            </p>
          </div>
        </div>
        <Link
          to="/wallet/account-details"
          className="flex w-full shrink-0 sm:inline-flex sm:w-auto"
        >
          <Button variant="glass" size="sm" fullWidth>
            Edit details
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card
      variant="solid"
      className="flex flex-col gap-3 border-amber-500/30 bg-amber-500/10 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
          <Trophy className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="wrap-break-word text-sm font-semibold text-base-content">
            You won {prize} for {place} place!
          </p>
          <p className="mt-0.5 wrap-break-word text-xs text-base-content/60">
            Add your payout account details so we can send your prize by bank
            transfer.
          </p>
        </div>
      </div>
      <Link
        to="/wallet/account-details"
        className="flex w-full shrink-0 sm:inline-flex sm:w-auto"
      >
        <Button variant="secondary" size="sm" fullWidth>
          Add account details
        </Button>
      </Link>
    </Card>
  );
}

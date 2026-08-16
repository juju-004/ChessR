import { memo } from "react";
import { Trophy, Frown, Handshake, Ban } from "lucide-react";
import { Card, Button } from "./ui/index.js";
import { RatingBadge } from "./RatingBadge.js";
import type { RatingSideUpdate } from "./game/types.js";

interface GameOverModalProps {
  result: string | null;
  reason: string;
  myColor?: 'white' | 'black';
  isPlayer: boolean;
  canRematch: boolean;
  rematchState: 'idle' | 'offered';
  wagerSettlement?: {
    wagerTokens: number;
    potTokens: number;
    winnerId: string | null;
    payoutTokens: number;
    rakeTokens: number;
  } | null;
  myUserId?: string;
  ratingUpdate?: RatingSideUpdate | null;
  onRematch: () => void;
  onClose: () => void;
}

function titleFor(result: string | null, myColor: 'white' | 'black' | undefined, isPlayer: boolean): string {
  if (result === null) return 'Game Aborted';
  if (result === 'draw') return 'Draw';
  if (isPlayer && myColor) return result === myColor ? 'You Won!' : 'You Lost';
  return result === 'white' ? 'White Wins' : 'Black Wins';
}

function reasonText(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export const GameOverModal = memo(function GameOverModal({
  result,
  reason,
  myColor,
  isPlayer,
  canRematch,
  rematchState,
  wagerSettlement,
  myUserId,
  ratingUpdate,
  onRematch,
  onClose,
}: GameOverModalProps) {
  const title = titleFor(result, myColor, isPlayer);
  const isWin = isPlayer && myColor && result === myColor;
  const isLoss = isPlayer && myColor && result !== null && result !== 'draw' && result !== myColor;
  const Icon = result === null ? Ban : isWin ? Trophy : isLoss ? Frown : Handshake;

  const wagerText = (() => {
    if (!isPlayer || !wagerSettlement || wagerSettlement.wagerTokens <= 0) return null;
    if (wagerSettlement.winnerId === null) {
      return `Draw — your ${wagerSettlement.wagerTokens} R Coin stake was refunded.`;
    }
    if (wagerSettlement.winnerId === myUserId) {
      return `You won ${wagerSettlement.payoutTokens} R Coins!`;
    }
    return `You lost your ${wagerSettlement.wagerTokens} R Coin stake.`;
  })();

  // Only worth a line when the tier actually changed — a same-tier result
  // (the overwhelmingly common case) has nothing new to say. Unranked →
  // a real tier for the first time counts as a change too, not just a
  // tier-to-tier move.
  const rankChanged =
    !!ratingUpdate && ratingUpdate.newCategory !== ratingUpdate.previousCategory;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <Card
        variant="strong"
        className="relative w-full max-w-sm text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-base-content/50 hover:text-base-content/80"
        >
          ✕
        </button>

        <div
          className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full ${
            isWin
              ? 'bg-green-500/15 text-green-400'
              : isLoss
                ? 'bg-red-500/15 text-red-400'
                : 'gradient-brand text-white'
          }`}
        >
          <Icon className="h-7 w-7" />
        </div>

        <h2
          className={`mb-1 text-2xl font-bold ${
            isWin ? 'text-green-400' : isLoss ? 'text-red-400' : 'text-base-content'
          }`}
        >
          {title}
        </h2>
        <p className="mb-5 text-sm text-base-content/60">{reasonText(reason)}</p>

        {wagerText && (
          <p
            className={`mb-5 text-sm font-semibold ${
              wagerSettlement?.winnerId === null
                ? 'text-base-content/80'
                : wagerSettlement?.winnerId === myUserId
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {wagerText}
          </p>
        )}

        {rankChanged && ratingUpdate && (
          <div className="mb-5 flex items-center justify-center gap-2 rounded-xl bg-base-200/70 px-3 py-2.5 text-sm">
            <span className="font-medium text-base-content/70">
              {ratingUpdate.previousCategory === null ? "You've been ranked" : "Rank updated"}
            </span>
            <RatingBadge category={ratingUpdate.newCategory} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {canRematch && (
            <Button onClick={onRematch} disabled={rematchState === 'offered'} loading={false} fullWidth>
              {rematchState === 'offered' ? 'Rematch offer sent…' : 'Rematch'}
            </Button>
          )}
          <Button variant="glass" onClick={onClose} fullWidth>
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
})

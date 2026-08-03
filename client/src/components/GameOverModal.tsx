import { memo } from "react";
import { Trophy, Frown, Handshake, Ban } from "lucide-react";
import { Card, Button } from "./ui/index.js";

interface GameOverModalProps {
  result: string | null;
  reason: string;
  myColor?: 'white' | 'black';
  isPlayer: boolean;
  canRematch: boolean;
  rematchState: 'idle' | 'offered';
  wagerSettlement?: { wagerTokens: number; potTokens: number; winnerId: string | null } | null;
  myUserId?: string;
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
      return `Draw — your ${wagerSettlement.wagerTokens} R token stake was refunded.`;
    }
    if (wagerSettlement.winnerId === myUserId) {
      return `You won ${wagerSettlement.potTokens} R tokens!`;
    }
    return `You lost your ${wagerSettlement.wagerTokens} R token stake.`;
  })();

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

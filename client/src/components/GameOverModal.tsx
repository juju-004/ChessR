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
  if (isPlayer && myColor) return result === myColor ? 'You Won! 🎉' : 'You Lost';
  return result === 'white' ? 'White Wins' : 'Black Wins';
}

function reasonText(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function GameOverModal({
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
      <div
        className="relative w-full max-w-sm rounded-xl border border-base-300 bg-base-200 p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-base-content/50 hover:text-base-content/80"
        >
          ✕
        </button>

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
            <button
              onClick={onRematch}
              disabled={rematchState === 'offered'}
              className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {rematchState === 'offered' ? 'Rematch offer sent…' : 'Rematch'}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md bg-base-300 px-4 py-2 font-semibold text-base-content hover:bg-base-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

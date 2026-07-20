interface GameOverModalProps {
  result: string | null;
  reason: string;
  myColor?: 'white' | 'black';
  isPlayer: boolean;
  canRematch: boolean;
  rematchState: 'idle' | 'offered';
  ratingChange?: { whiteRating: number; blackRating: number; whiteDelta: number; blackDelta: number } | null;
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
  ratingChange,
  onRematch,
  onClose,
}: GameOverModalProps) {
  const title = titleFor(result, myColor, isPlayer);
  const isWin = isPlayer && myColor && result === myColor;
  const isLoss = isPlayer && myColor && result !== null && result !== 'draw' && result !== myColor;

  const myDelta =
    isPlayer && myColor && ratingChange
      ? myColor === 'white'
        ? { rating: ratingChange.whiteRating, delta: ratingChange.whiteDelta }
        : { rating: ratingChange.blackRating, delta: ratingChange.blackDelta }
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-900 p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-neutral-500 hover:text-neutral-300"
        >
          ✕
        </button>

        <h2
          className={`mb-1 text-2xl font-bold ${
            isWin ? 'text-green-400' : isLoss ? 'text-red-400' : 'text-neutral-100'
          }`}
        >
          {title}
        </h2>
        <p className="mb-5 text-sm text-neutral-400">{reasonText(reason)}</p>

        {myDelta && (
          <p className="mb-5 text-sm">
            <span className="text-neutral-400">New rating: </span>
            <span className="font-semibold text-neutral-100">{myDelta.rating}</span>{' '}
            <span className={myDelta.delta >= 0 ? 'text-green-400' : 'text-red-400'}>
              ({myDelta.delta >= 0 ? '+' : ''}
              {myDelta.delta})
            </span>
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
            className="rounded-md bg-neutral-700 px-4 py-2 font-semibold text-neutral-100 hover:bg-neutral-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

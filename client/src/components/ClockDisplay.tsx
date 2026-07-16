import { useEffect, useState } from 'react';
import { formatClock, turnColor } from '../chessUtils.js';
import { Chess } from 'chess.js';

interface ClockDisplayProps {
  fen: string;
  whiteRemainingMs: number | null;
  blackRemainingMs: number | null;
  turnStartedAtMs: number;
  isActive: boolean;
}

export function ClockDisplay({
  fen,
  whiteRemainingMs,
  blackRemainingMs,
  turnStartedAtMs,
  isActive,
}: ClockDisplayProps) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!isActive || whiteRemainingMs === null || blackRemainingMs === null) return;
    const interval = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(interval);
  }, [isActive, whiteRemainingMs, blackRemainingMs]);

  if (whiteRemainingMs === null || blackRemainingMs === null) {
    return (
      <div className="mb-3 flex gap-3">
        <div className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-center font-mono text-sm text-neutral-400">
          Black · ∞
        </div>
        <div className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-center font-mono text-sm text-neutral-400">
          White · ∞
        </div>
      </div>
    );
  }

  const sideToMove = turnColor(new Chess(fen));
  const elapsed = isActive ? Date.now() - turnStartedAtMs : 0;
  const liveWhite = sideToMove === 'white' ? whiteRemainingMs - elapsed : whiteRemainingMs;
  const liveBlack = sideToMove === 'black' ? blackRemainingMs - elapsed : blackRemainingMs;

  return (
    <div className="mb-3 flex gap-3">
      <div
        className={`flex-1 rounded-md px-3 py-2 text-center font-mono text-sm font-semibold ${
          isActive && sideToMove === 'black' ? 'bg-blue-900 text-blue-100' : 'bg-neutral-900 text-neutral-300'
        }`}
      >
        Black · {formatClock(liveBlack)}
      </div>
      <div
        className={`flex-1 rounded-md px-3 py-2 text-center font-mono text-sm font-semibold ${
          isActive && sideToMove === 'white' ? 'bg-blue-900 text-blue-100' : 'bg-neutral-900 text-neutral-300'
        }`}
      >
        White · {formatClock(liveWhite)}
      </div>
    </div>
  );
}

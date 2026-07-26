import { useEffect, useState } from 'react';
import { formatClock, turnColor } from '../chessUtils.js';
import { Chess } from 'chess.js';

interface ClockDisplayProps {
  fen: string;
  whiteRemainingMs: number | null;
  blackRemainingMs: number | null;
  turnStartedAtMs: number;
  isActive: boolean;
  // How many plies have been played so far. The real clock (server-side)
  // doesn't start counting down until BOTH sides have made their first move
  // — this display mirrors that so it doesn't misleadingly tick during the
  // idle opening window only to visually "snap back" once someone moves.
  movesPlayed: number;
  whiteUsername?: string;
  blackUsername?: string;
  whiteConnected?: boolean;
  blackConnected?: boolean;
}

export function ClockDisplay({
  fen,
  whiteRemainingMs,
  blackRemainingMs,
  turnStartedAtMs,
  isActive,
  movesPlayed,
  whiteUsername,
  blackUsername,
  whiteConnected,
  blackConnected,
}: ClockDisplayProps) {
  const [, forceTick] = useState(0);
  const clockRunning = isActive && movesPlayed >= 2;

  useEffect(() => {
    if (!clockRunning || whiteRemainingMs === null || blackRemainingMs === null) return;
    // 100ms keeps the tenths-of-a-second digit in formatClock's MM:SS:D
    // display ticking smoothly without being wastefully frequent.
    const interval = window.setInterval(() => forceTick((n) => n + 1), 100);
    return () => window.clearInterval(interval);
  }, [clockRunning, whiteRemainingMs, blackRemainingMs]);

  const dot = (connected?: boolean) => (
    <span
      className={`mr-1.5 inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-neutral-600'}`}
      title={connected ? 'Connected' : 'Not connected'}
    />
  );

  const whiteLabel = whiteUsername ? `White · ${whiteUsername}` : 'White';
  const blackLabel = blackUsername ? `Black · ${blackUsername}` : 'Black';

  if (whiteRemainingMs === null || blackRemainingMs === null) {
    return (
      <div className="mb-3 flex gap-3">
        <div className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-center font-mono text-sm text-neutral-400">
          {dot(blackConnected)}
          {blackLabel} · ∞
        </div>
        <div className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-center font-mono text-sm text-neutral-400">
          {dot(whiteConnected)}
          {whiteLabel} · ∞
        </div>
      </div>
    );
  }

  const sideToMove = turnColor(new Chess(fen));
  const elapsed = clockRunning ? Date.now() - turnStartedAtMs : 0;
  const liveWhite = sideToMove === 'white' ? whiteRemainingMs - elapsed : whiteRemainingMs;
  const liveBlack = sideToMove === 'black' ? blackRemainingMs - elapsed : blackRemainingMs;

  return (
    <div className="mb-3 flex gap-3">
      <div
        className={`flex-1 rounded-md px-3 py-2 text-center font-mono text-sm font-semibold ${
          isActive && sideToMove === 'black' ? 'bg-blue-900 text-blue-100' : 'bg-neutral-900 text-neutral-300'
        }`}
      >
        {dot(blackConnected)}
        {blackLabel} · {formatClock(liveBlack, true)}
      </div>
      <div
        className={`flex-1 rounded-md px-3 py-2 text-center font-mono text-sm font-semibold ${
          isActive && sideToMove === 'white' ? 'bg-blue-900 text-blue-100' : 'bg-neutral-900 text-neutral-300'
        }`}
      >
        {dot(whiteConnected)}
        {whiteLabel} · {formatClock(liveWhite, true)}
      </div>
    </div>
  );
}

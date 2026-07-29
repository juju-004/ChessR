import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { formatClock, turnColor, computeMaterialDiff, type CapturedPieceCount } from '../chessUtils.js';
import { Avatar } from './ui/index.js';
import { cn } from '../lib/cn.js';

interface PlayerPanelsProps {
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
  /** Board orientation — the panel matching this color renders on the
   *  bottom (i.e. "your" seat), the other on top. */
  orientation: 'white' | 'black';
}

// Black-tinted glyphs represent pieces captured *from* black (shown on
// white's panel); white-tinted glyphs represent pieces captured from white
// (shown on black's panel) — same visual convention lichess/chess.com use.
const BLACK_GLYPH: Record<CapturedPieceCount['type'], string> = {
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};
const WHITE_GLYPH: Record<CapturedPieceCount['type'], string> = {
  q: '♕',
  r: '♖',
  b: '♗',
  n: '♘',
  p: '♙',
};

function CapturedTray({
  pieces,
  glyphs,
  advantage,
}: {
  pieces: CapturedPieceCount[];
  glyphs: Record<CapturedPieceCount['type'], string>;
  /** Only rendered when > 0 — the other side's panel shows its own. */
  advantage: number;
}) {
  if (pieces.length === 0 && advantage <= 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-0.5 text-base-content/70">
      {pieces.map((p) => (
        <span key={p.type} className="flex items-center leading-none" title={`Captured ${p.count} ${p.type}`}>
          <span className="text-base leading-none">
            {glyphs[p.type].repeat(Math.min(p.count, 9))}
          </span>
        </span>
      ))}
      {advantage > 0 && (
        <span className="ml-0.5 text-xs font-bold text-(--primary)">+{advantage}</span>
      )}
    </div>
  );
}

function PlayerRow({
  username,
  color,
  isTurn,
  connected,
  liveMs,
  clockKnown,
  capturedPieces,
  glyphs,
  advantage,
}: {
  username: string;
  color: 'white' | 'black';
  isTurn: boolean;
  connected: boolean;
  liveMs: number | null;
  clockKnown: boolean;
  capturedPieces: CapturedPieceCount[];
  glyphs: Record<CapturedPieceCount['type'], string>;
  advantage: number;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 transition-colors',
        isTurn ? 'gradient-brand text-white shadow-md shadow-(--primary)/20' : 'bg-base-200/70 text-base-content',
      )}
    >
      <Avatar username={username} size="sm" status={connected ? 'online' : 'offline'} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-semibold', isTurn ? 'text-white' : 'text-base-content')}>
          {username}
        </p>
        <CapturedTray pieces={capturedPieces} glyphs={glyphs} advantage={advantage} />
      </div>
      <div
        className={cn(
          'shrink-0 rounded-lg px-2.5 py-1 text-right font-mono text-sm font-bold tabular-nums',
          isTurn ? 'bg-white/20 text-white' : 'bg-base-300/60 text-base-content/80',
        )}
      >
        {clockKnown ? formatClock(liveMs ?? 0, true) : '∞'}
      </div>
    </div>
  );
}

export function PlayerPanels({
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
  orientation,
}: PlayerPanelsProps) {
  const [, forceTick] = useState(0);
  const clockRunning = isActive && movesPlayed >= 2;
  const clockKnown = whiteRemainingMs !== null && blackRemainingMs !== null;

  useEffect(() => {
    if (!clockRunning || !clockKnown) return;
    // 100ms keeps the tenths-of-a-second digit in formatClock's MM:SS:D
    // display ticking smoothly without being wastefully frequent.
    const interval = window.setInterval(() => forceTick((n) => n + 1), 100);
    return () => window.clearInterval(interval);
  }, [clockRunning, clockKnown]);

  const sideToMove = turnColor(new Chess(fen));
  const elapsed = clockRunning ? Date.now() - turnStartedAtMs : 0;
  const liveWhite =
    clockKnown && sideToMove === 'white' ? (whiteRemainingMs as number) - elapsed : whiteRemainingMs;
  const liveBlack =
    clockKnown && sideToMove === 'black' ? (blackRemainingMs as number) - elapsed : blackRemainingMs;

  const material = computeMaterialDiff(fen);
  const whiteAdvantage = Math.max(0, material.advantage);
  const blackAdvantage = Math.max(0, -material.advantage);

  const whiteRow = (
    <PlayerRow
      key="white"
      username={whiteUsername ?? 'White'}
      color="white"
      isTurn={isActive && sideToMove === 'white'}
      connected={!!whiteConnected}
      liveMs={liveWhite}
      clockKnown={clockKnown}
      capturedPieces={material.capturedByWhite}
      glyphs={BLACK_GLYPH}
      advantage={whiteAdvantage}
    />
  );
  const blackRow = (
    <PlayerRow
      key="black"
      username={blackUsername ?? 'Black'}
      color="black"
      isTurn={isActive && sideToMove === 'black'}
      connected={!!blackConnected}
      liveMs={liveBlack}
      clockKnown={clockKnown}
      capturedPieces={material.capturedByBlack}
      glyphs={WHITE_GLYPH}
      advantage={blackAdvantage}
    />
  );

  // The panel for whoever is sitting at the "bottom" of the board (matching
  // orientation) renders last, mirroring the physical seating.
  return (
    <div className="mb-3 space-y-2">
      {orientation === 'white' ? (
        <>
          {blackRow}
          {whiteRow}
        </>
      ) : (
        <>
          {whiteRow}
          {blackRow}
        </>
      )}
    </div>
  );
}

import { formatClock, type CapturedPieceCount, type MaterialDiff } from '../chessUtils.js';
import { Avatar } from './ui/index.js';
import { cn } from '../lib/cn.js';

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

export interface PanelData {
  username: string;
  isTurn: boolean;
  connected: boolean;
  liveMs: number | null;
  clockKnown: boolean;
  capturedPieces: CapturedPieceCount[];
  glyphs: Record<CapturedPieceCount['type'], string>;
  advantage: number;
}

/** Builds the display props one side's panel needs out of the raw material
 *  diff — pulls out "which glyph set" and "which advantage number (if any)"
 *  so callers don't have to repeat that branching for every panel they
 *  render (a row on desktop, a flank column on mobile, etc). */
export function panelMaterial(color: 'white' | 'black', material: MaterialDiff) {
  return color === 'white'
    ? {
        capturedPieces: material.capturedByWhite,
        glyphs: BLACK_GLYPH,
        advantage: Math.max(0, material.advantage),
      }
    : {
        capturedPieces: material.capturedByBlack,
        glyphs: WHITE_GLYPH,
        advantage: Math.max(0, -material.advantage),
      };
}

function CapturedTray({
  pieces,
  glyphs,
  advantage,
  size = 'md',
}: {
  pieces: CapturedPieceCount[];
  glyphs: Record<CapturedPieceCount['type'], string>;
  advantage: number;
  size?: 'md' | 'sm';
}) {
  if (pieces.length === 0 && advantage <= 0) return null;
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-0.5 text-base-content/70',
        size === 'sm' && 'justify-center leading-none',
      )}
    >
      {pieces.map((p) => (
        <span
          key={p.type}
          className={cn('leading-none', size === 'sm' ? 'text-xs' : 'text-base')}
          title={`Captured ${p.count} ${p.type}`}
        >
          {glyphs[p.type].repeat(Math.min(p.count, 9))}
        </span>
      ))}
      {advantage > 0 && (
        <span className={cn('font-bold text-(--primary)', size === 'sm' ? 'text-[10px]' : 'ml-0.5 text-xs')}>
          +{advantage}
        </span>
      )}
    </div>
  );
}

/** Wide horizontal row — avatar, name + captured tray, clock, all in a
 *  line. Used for the desktop sidebar where there's room to spare. */
export function PlayerPanelRow({ username, isTurn, connected, liveMs, clockKnown, capturedPieces, glyphs, advantage }: PanelData) {
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

/** Narrow vertical column — avatar/name/clock/captures stacked. Used to
 *  flank the board on mobile, where there's height (alongside the board)
 *  but very little width to work with. */
export function PlayerPanelFlank({ username, isTurn, connected, liveMs, clockKnown, capturedPieces, glyphs, advantage, className }: PanelData & { className?: string }) {
  return (
    <div
      className={cn(
        'flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition-colors sm:w-16',
        isTurn ? 'gradient-brand text-white shadow-md shadow-(--primary)/20' : 'bg-base-200/70 text-base-content',
        className,
      )}
    >
      <Avatar username={username} size="sm" status={connected ? 'online' : 'offline'} />
      <p className={cn('w-full truncate text-[11px] font-semibold', isTurn ? 'text-white' : 'text-base-content')}>
        {username}
      </p>
      <div
        className={cn(
          'rounded-md px-1.5 py-1 font-mono text-xs font-bold tabular-nums',
          isTurn ? 'bg-white/20 text-white' : 'bg-base-300/60 text-base-content/80',
        )}
      >
        {clockKnown ? formatClock(liveMs ?? 0, true) : '∞'}
      </div>
      <CapturedTray pieces={capturedPieces} glyphs={glyphs} advantage={advantage} size="sm" />
    </div>
  );
}

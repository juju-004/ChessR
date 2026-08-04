import { useEffect, useState, memo } from "react";
import {
  formatClock,
  type CapturedPieceCount,
  type MaterialDiff,
} from "../chessUtils.js";
import { Avatar } from "./ui/index.js";
import { cn } from "../lib/cn.js";

// Black-tinted glyphs represent pieces captured *from* black (shown on
// white's panel); white-tinted glyphs represent pieces captured from white
// (shown on black's panel) — same visual convention lichess/chess.com use.
const BLACK_GLYPH: Record<CapturedPieceCount["type"], string> = {
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};
const WHITE_GLYPH: Record<CapturedPieceCount["type"], string> = {
  q: "♕",
  r: "♖",
  b: "♗",
  n: "♘",
  p: "♙",
};

export interface PanelData {
  username: string;
  avatarGradient?: string | null;
  isTurn: boolean;
  connected: boolean;
  /** Server-confirmed remaining time as of `turnStartedAtMs` — NOT a live
   *  value. `ClockBadge` below derives the live countdown itself. */
  baseRemainingMs: number | null;
  turnStartedAtMs: number;
  /** True only while this side's clock is actively counting down. */
  isTicking: boolean;
  clockKnown: boolean;
  /** From computeLowTimeThresholdMs — 0 means "never low" (unlimited time). */
  lowTimeThresholdMs: number;
  /** Net (already-cancelled) piece-type breakdown of this side's material
   *  lead — empty if this side isn't ahead. */
  pieceDiff: CapturedPieceCount[];
  glyphs: Record<CapturedPieceCount["type"], string>;
  /** Points this side is ahead by, 0 or negative if not ahead (or even). */
  advantage: number;
}

/** Builds the display props one side's panel needs out of the raw material
 *  diff — the net per-type piece breakdown plus the point advantage — so
 *  callers don't have to repeat the white/black branching for every panel
 *  they render (a row on desktop, a flank column on mobile, etc). */
export function panelMaterial(
  color: "white" | "black",
  material: MaterialDiff,
) {
  return color === "white"
    ? {
        pieceDiff: material.netCapturedByWhite,
        glyphs: BLACK_GLYPH,
        advantage: Math.max(0, material.advantage),
      }
    : {
        pieceDiff: material.netCapturedByBlack,
        glyphs: WHITE_GLYPH,
        advantage: Math.max(0, -material.advantage),
      };
}

/** Material-diff display — the net per-type piece icons this side is up
 *  (already cancelled against the other side's captures of the same
 *  type, so a pawn-for-pawn trade shows nothing), plus a "+N" total point
 *  badge. Renders nothing at all when this side isn't ahead. */
function MaterialBadge({
  pieceDiff,
  glyphs,
  advantage,
  size = "md",
}: {
  pieceDiff: CapturedPieceCount[];
  glyphs: Record<CapturedPieceCount["type"], string>;
  advantage: number;
  size?: "md" | "sm";
}) {
  if (advantage <= 0) return null;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-0.5 text-base-content/70",
        size === "sm" && "justify-center leading-none",
      )}
    >
      {pieceDiff.map((p) => (
        <span
          key={p.type}
          className={cn("leading-none", size === "sm" ? "text-xs" : "text-sm")}
          title={`Up ${p.count} ${p.type}`}
        >
          {glyphs[p.type].repeat(Math.min(p.count, 9))}
        </span>
      ))}
      <span
        className={cn(
          "font-bold text-(--primary)",
          size === "sm" ? "text-[10px]" : "ml-0.5 text-xs",
        )}
      >
        +{advantage}
      </span>
    </div>
  );
}

function computeLiveMs(
  baseRemainingMs: number | null,
  turnStartedAtMs: number,
  isTicking: boolean,
): number | null {
  if (baseRemainingMs === null) return null;
  return isTicking ? baseRemainingMs - (Date.now() - turnStartedAtMs) : baseRemainingMs;
}

/**
 * The actual ticking countdown badge, split out into its own component so
 * its 100ms re-render (while `isTicking`) is scoped to just this small
 * node instead of the whole game page.
 *
 * This used to be a value (`liveMs`) computed in Game.tsx's render body
 * from a page-level 100ms `setInterval` — which meant every clock tick
 * re-rendered the entire page (board, sidebar, any open modal) 10x/sec.
 * On low-end devices that main-thread churn was enough to visibly stutter
 * unrelated things like a modal's entrance animation. Moving the tick
 * down here means a running clock only ever re-renders this badge.
 */
function ClockBadge({
  baseRemainingMs,
  turnStartedAtMs,
  isTicking,
  isTurn,
  clockKnown,
  lowTimeThresholdMs,
  size = "md",
}: {
  baseRemainingMs: number | null;
  turnStartedAtMs: number;
  isTicking: boolean;
  isTurn: boolean;
  clockKnown: boolean;
  lowTimeThresholdMs: number;
  size?: "md" | "sm";
}) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!isTicking) return;
    const interval = window.setInterval(() => forceTick((n) => n + 1), 100);
    return () => window.clearInterval(interval);
  }, [isTicking]);

  const liveMs = computeLiveMs(baseRemainingMs, turnStartedAtMs, isTicking);
  const isLow =
    clockKnown &&
    liveMs !== null &&
    liveMs > 0 &&
    lowTimeThresholdMs > 0 &&
    liveMs < lowTimeThresholdMs;

  return (
    <div
      className={cn(
        size === "sm"
          ? "rounded-md px-1.5 py-1 font-mono text-xs font-bold tabular-nums"
          : "shrink-0 rounded-lg px-2.5 py-1 text-right font-mono text-sm font-bold tabular-nums",
        isLow
          ? "animate-pulse bg-red-500/15 text-red-500"
          : isTurn
            ? "bg-white/20 text-white"
            : "bg-base-300/60 text-base-content/80",
      )}
    >
      {clockKnown ? formatClock(liveMs ?? 0) : "∞"}
    </div>
  );
}

/** Wide horizontal row — avatar, name + captured tray, clock, all in a
 *  line. Used for the desktop sidebar where there's room to spare. */
export const PlayerPanelRow = memo(function PlayerPanelRow({
  username,
  avatarGradient,
  isTurn,
  connected,
  baseRemainingMs,
  turnStartedAtMs,
  isTicking,
  clockKnown,
  lowTimeThresholdMs,
  pieceDiff,
  glyphs,
  advantage,
}: PanelData) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
        isTurn
          ? "gradient-brand text-white shadow-md shadow-(--primary)/20"
          : "bg-base-200/70 text-base-content",
      )}
    >
      <Avatar
        username={username}
        gradient={avatarGradient}
        size="sm"
        status={connected ? "online" : "offline"}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-semibold",
            isTurn ? "text-white" : "text-base-content",
          )}
        >
          {username}
        </p>
        <MaterialBadge
          pieceDiff={pieceDiff}
          glyphs={glyphs}
          advantage={advantage}
        />
      </div>
      <ClockBadge
        baseRemainingMs={baseRemainingMs}
        turnStartedAtMs={turnStartedAtMs}
        isTicking={isTicking}
        isTurn={isTurn}
        clockKnown={clockKnown}
        lowTimeThresholdMs={lowTimeThresholdMs}
      />
    </div>
  );
});

/** Narrow vertical column — avatar/name/clock/captures stacked. Used to
 *  flank the board on mobile, where there's height (alongside the board)
 *  but very little width to work with. */
export const PlayerPanelFlank = memo(function PlayerPanelFlank({
  username,
  avatarGradient,
  isTurn,
  connected,
  baseRemainingMs,
  turnStartedAtMs,
  isTicking,
  clockKnown,
  lowTimeThresholdMs,
  pieceDiff,
  glyphs,
  advantage,
  className,
}: PanelData & { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition-colors sm:w-16",
        isTurn
          ? "gradient-brand text-white shadow-md shadow-(--primary)/20"
          : "bg-base-200/70 text-base-content",
        className,
      )}
    >
      <Avatar
        username={username}
        gradient={avatarGradient}
        size="sm"
        status={connected ? "online" : "offline"}
      />
      <p
        className={cn(
          "w-full truncate text-[11px] font-semibold",
          isTurn ? "text-white" : "text-base-content",
        )}
      >
        {username}
      </p>
      <ClockBadge
        baseRemainingMs={baseRemainingMs}
        turnStartedAtMs={turnStartedAtMs}
        isTicking={isTicking}
        isTurn={isTurn}
        clockKnown={clockKnown}
        lowTimeThresholdMs={lowTimeThresholdMs}
        size="sm"
      />
      <MaterialBadge
        pieceDiff={pieceDiff}
        glyphs={glyphs}
        advantage={advantage}
        size="sm"
      />
    </div>
  );
});

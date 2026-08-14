import { useEffect, useState, memo } from "react";
import { Link } from "react-router-dom";
import { Swords } from "lucide-react";
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
  /** Non-null only while THIS side's first move is the one still pending
   *  (moveCount 0 for white, 1 for black) — the grace window in ms from
   *  computeFirstMoveThresholdMs. Renders in the same slot as MaterialBadge
   *  below the username, since the two can never be relevant at once (no
   *  capture is possible before either side's first move has even landed),
   *  which is what keeps this from ever pushing the board around. */
  firstMoveGraceMs: number | null;
  /** True once this side has berserked — shows a small icon next to the
   *  clock, close enough that it reads as "this clock got halved" rather
   *  than a generic status tag. */
  berserked: boolean;
  /** Set only once a real player occupies this seat (not the "White"/
   *  "Black" placeholder shown before anyone's joined) — when present, the
   *  panel's avatar/name link through to that player's profile. */
  profileHref?: string | null;
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

/**
 * Countdown for a still-pending first move, in the same slot MaterialBadge
 * would otherwise occupy (see the `firstMoveGraceMs` doc comment above for
 * why that's safe). Deliberately stays invisible for the first 5 seconds —
 * nobody needs to be told to hurry up the instant the board loads — then
 * counts down the seconds left before this side's first move costs them the
 * game (or the game gets aborted, for a plain non-series game).
 */
function FirstMoveBadge({
  turnStartedAtMs,
  graceMs,
  size = "md",
}: {
  turnStartedAtMs: number;
  graceMs: number;
  size?: "md" | "sm";
}) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => forceTick((n) => n + 1), 500);
    return () => window.clearInterval(interval);
  }, []);

  const elapsedMs = Date.now() - turnStartedAtMs;
  const remainingMs = graceMs - elapsedMs;

  // Not yet 5s in, or already expired (the server-side timeout will resolve
  // the game momentarily) — render nothing rather than a stale "0s".
  if (elapsedMs < 5000 || remainingMs <= 0) return null;

  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1 font-semibold text-red-400",
        size === "sm" ? "justify-center text-[10px]" : "text-xs",
      )}
      title="Move now — running out of time costs this game"
    >
      <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
      Move in {seconds}s
    </div>
  );
}

/** Small badge icon shown right next to the clock once a side has
 *  berserked — a halved clock is a big deal, so it stays close to the thing
 *  it actually affects rather than living up with the game-level badges. */
function BerserkBadge({ size = "md" }: { size?: "md" | "sm" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400",
        size === "sm" ? "h-4 w-4" : "h-5 w-5",
      )}
      title="Berserked — clock halved for a bonus point if they win"
    >
      <Swords className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
    </span>
  );
}

function computeLiveMs(
  baseRemainingMs: number | null,
  turnStartedAtMs: number,
  isTicking: boolean,
): number | null {
  if (baseRemainingMs === null) return null;
  return isTicking
    ? baseRemainingMs - (Date.now() - turnStartedAtMs)
    : baseRemainingMs;
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
          ? "rounded-md px-1.5 py-1 font-mono text-xs font-bold tabular-nums transition-colors"
          : "shrink-0 rounded-lg px-2.5 py-1 text-right font-mono text-sm font-bold tabular-nums transition-colors",
        isLow
          ? "animate-pulse bg-red-500/15 text-red-500"
          : isTurn
            ? "gradient-brand text-white shadow-sm shadow-(--primary)/30"
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
  firstMoveGraceMs,
  berserked,
  profileHref,
}: PanelData) {
  return (
    <div className="flex h-[54px] items-center gap-3 rounded-xl bg-base-200/70 px-3 py-2 text-base-content">
      {profileHref ? (
        <Link to={profileHref} className="shrink-0">
          <Avatar
            username={username}
            gradient={avatarGradient}
            size="sm"
            status={connected ? "online" : "offline"}
          />
        </Link>
      ) : (
        <Avatar
          username={username}
          gradient={avatarGradient}
          size="sm"
          status={connected ? "online" : "offline"}
        />
      )}
      {/* No min-h reserved here on purpose — when neither badge below has
       *  anything to show, this column is just the username line, and
       *  `items-center` on the row centers it normally. The row itself is
       *  a fixed height (above), not this column, so when a badge *does*
       *  render, the now-taller two-line column re-centers (shifting the
       *  username up to make room) without changing the row's own size —
       *  which matters because on phone this row is a flex sibling of the
       *  board itself (see .game-area-toppanel/-bottompanel in Game.tsx),
       *  so a resizing row would resize the board mid-game. */}
      <div className="min-w-0 flex-1">
        {profileHref ? (
          <Link
            to={profileHref}
            className="block truncate text-sm font-semibold text-base-content hover:text-(--primary)"
          >
            {username}
          </Link>
        ) : (
          <p className="truncate text-sm font-semibold text-base-content">
            {username}
          </p>
        )}
        {firstMoveGraceMs !== null ? (
          <FirstMoveBadge
            turnStartedAtMs={turnStartedAtMs}
            graceMs={firstMoveGraceMs}
          />
        ) : (
          <MaterialBadge
            pieceDiff={pieceDiff}
            glyphs={glyphs}
            advantage={advantage}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {berserked && <BerserkBadge />}
        <ClockBadge
          baseRemainingMs={baseRemainingMs}
          turnStartedAtMs={turnStartedAtMs}
          isTicking={isTicking}
          isTurn={isTurn}
          clockKnown={clockKnown}
          lowTimeThresholdMs={lowTimeThresholdMs}
        />
      </div>
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
  firstMoveGraceMs,
  berserked,
  profileHref,
  className,
}: PanelData & { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-xl bg-base-200/70 px-1 py-2 text-center text-base-content sm:w-16",
        className,
      )}
    >
      {profileHref ? (
        <Link to={profileHref}>
          <Avatar
            username={username}
            gradient={avatarGradient}
            size="sm"
            status={connected ? "online" : "offline"}
          />
        </Link>
      ) : (
        <Avatar
          username={username}
          gradient={avatarGradient}
          size="sm"
          status={connected ? "online" : "offline"}
        />
      )}
      {profileHref ? (
        <Link
          to={profileHref}
          className="w-full truncate text-[11px] font-semibold text-base-content hover:text-(--primary) hover:underline"
        >
          {username}
        </Link>
      ) : (
        <p className="w-full truncate text-[11px] font-semibold text-base-content">
          {username}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {berserked && <BerserkBadge size="sm" />}
        <ClockBadge
          baseRemainingMs={baseRemainingMs}
          turnStartedAtMs={turnStartedAtMs}
          isTicking={isTicking}
          isTurn={isTurn}
          clockKnown={clockKnown}
          lowTimeThresholdMs={lowTimeThresholdMs}
          size="sm"
        />
      </div>
      {/* Fixed height for the same reason as PlayerPanelRow's equivalent
       *  slot — see its comment. */}
      <div className="min-h-3.5 w-full">
        {firstMoveGraceMs !== null ? (
          <FirstMoveBadge
            turnStartedAtMs={turnStartedAtMs}
            graceMs={firstMoveGraceMs}
            size="sm"
          />
        ) : (
          <MaterialBadge
            pieceDiff={pieceDiff}
            glyphs={glyphs}
            advantage={advantage}
            size="sm"
          />
        )}
      </div>
    </div>
  );
});

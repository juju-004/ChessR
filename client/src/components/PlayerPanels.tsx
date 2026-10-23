import { useEffect, useState, memo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Swords, UserRound } from "lucide-react";
import {
  formatClock,
  msUntilClockRepaint,
  msUntilNextWholeSecond,
  type CapturedPieceCount,
  type MaterialDiff,
} from "../chessUtils.js";
import { Avatar } from "./ui/index.js";
import { RatingBadge } from "./RatingBadge.js";
import { cn } from "../lib/cn.js";
import { serverNow } from "../lib/clockSync.js";

// Black-tinted glyphs represent pieces captured *from* black (shown on
// white's panel); white-tinted glyphs represent pieces captured from white
// (shown on black's panel), same visual convention lichess/chess.com use.
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
  /** Server-confirmed remaining time as of `turnStartedAtMs`. NOT a live
   *  value. `ClockBadge` below derives the live countdown itself. */
  baseRemainingMs: number | null;
  turnStartedAtMs: number;
  /** True only while this side's clock is actively counting down. */
  isTicking: boolean;
  clockKnown: boolean;
  /** From computeLowTimeThresholdMs, 0 means "never low" (unlimited time). */
  lowTimeThresholdMs: number;
  /** Net (already-cancelled) piece-type breakdown of this side's material
   *  lead, empty if this side isn't ahead. */
  pieceDiff: CapturedPieceCount[];
  glyphs: Record<CapturedPieceCount["type"], string>;
  /** Points this side is ahead by, 0 or negative if not ahead (or even). */
  advantage: number;
  /** Non-null only while THIS side's first move is the one still pending
   *  (moveCount 0 for white, 1 for black), the grace window in ms from
   *  computeFirstMoveThresholdMs. Renders in the same slot as MaterialBadge
   *  below the username, since the two can never be relevant at once (no
   *  capture is possible before either side's first move has even landed),
   *  which is what keeps this from ever pushing the board around. */
  firstMoveGraceMs: number | null;
  /** True once this side has berserked, shows a small icon next to the
   *  clock, close enough that it reads as "this clock got halved" rather
   *  than a generic status tag. */
  berserked: boolean;
  /** Set only once a real player occupies this seat (not the "White"/
   *  "Black" placeholder shown before anyone's joined), when present, the
   *  panel's avatar/name link through to that player's profile. */
  profileHref?: string | null;
  /** The player's numeric rating. Only shown once profileHref is set
   *  (a real player, not the placeholder seat). */
  rating?: number | null;
  /** Strips identity (avatar, username, profile link, rating badge) and
   *  material difference down to a neutral placeholder, everything else
   *  (clock, berserk, first-move countdown) still renders as normal, see
   *  GameDetailsCard for zen mode's other effects (move list, badges). */
  zenMode?: boolean;
  /** Set only on the OPPONENT's panel while they're disconnected (and the
   *  game is past its idle phase). Replaces the old floating banner: the
   *  countdown / claim buttons render in the same slot under the username
   *  as the "Move in Xs" badge and the material badge. */
  disconnect?: {
    expiresAt: number;
    onClaim: (claim: "win" | "draw") => void;
  } | null;
  /** Today's running score against this opponent (win 1, draw 0.5).
   *  null/undefined hides the badge, it only appears once the same two
   *  players have met more than once that day. */
  score?: number | null;
}

function ScoreBadge({ score, className }: { score: number; className?: string }) {
  return (
    <span
      title="Today's score"
      className={cn(
        "inline-flex min-w-5 shrink-0 items-center justify-center rounded-md bg-base-300/70 px-1.5 py-0.5 text-xs font-bold tabular-nums text-base-content/80",
        className,
      )}
    >
      {Number.isInteger(score) ? score : score.toFixed(1)}
    </span>
  );
}

/** Builds the display props one side's panel needs out of the raw material
 *  diff, the net per-type piece breakdown plus the point advantage, so
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

/** Material-diff display, the net per-type piece icons this side is up
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
  // Piece icons and the point total are gated separately on purpose: which
  // pieces THIS side captured shouldn't depend on the overall score. If
  // you're up a bishop but down a rook elsewhere, `advantage` (the net
  // point total) is negative even though you genuinely captured a bishop
  //, the old `advantage <= 0` check hid the icons in that case too, which
  // is the bug where a capture just silently didn't show on either panel
  // whenever the two sides' captures happened to net out even overall.
  // The "+N" point total, on the other hand, only makes sense on whichever
  // side is actually ahead, so that part stays gated on advantage > 0.
  if (pieceDiff.length === 0 && advantage <= 0) return null;
  return (
    <div
      className={cn(
        // Never wraps: a long capture list is clipped rather than growing
        // the panel, which on phone would resize the board.
        "flex min-w-0 flex-nowrap items-center gap-0.5 overflow-hidden whitespace-nowrap leading-none text-base-content/70",
        size === "sm" && "justify-center",
      )}
    >
      {pieceDiff.map((p) => (
        <span
          key={p.type}
          className={cn(
            "leading-none",
            size === "sm" ? "text-[11px]" : "text-xs md:text-sm",
          )}
          title={`Up ${p.count} ${p.type}`}
        >
          {glyphs[p.type].repeat(Math.min(p.count, 9))}
        </span>
      ))}
      {advantage > 0 && (
        <span
          className={cn(
            "font-bold leading-none text-(--primary)",
            size === "sm" ? "text-[9px]" : "ml-0.5 text-[10px] md:text-xs",
          )}
        >
          +{advantage}
        </span>
      )}
    </div>
  );
}

/**
 * Countdown for a still-pending first move, in the same slot MaterialBadge
 * would otherwise occupy (see the `firstMoveGraceMs` doc comment above for
 * why that's safe). Deliberately stays invisible for the first 5 seconds,
 * nobody needs to be told to hurry up the instant the board loads, then
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

  // Wakes only when the badge's output can change: once when it first
  // becomes visible (5s in), then on each whole-second boundary of the
  // countdown, and a last time when it expires and hides. Replaces a
  // free-running 500ms poll that re-rendered twice per visible change.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const elapsedMs = serverNow() - turnStartedAtMs;
      const remainingMs = graceMs - elapsedMs;
      if (remainingMs <= 0) return;
      const delay =
        elapsedMs < 5000
          ? 5000 - elapsedMs + 2
          : msUntilNextWholeSecond(remainingMs);
      timer = window.setTimeout(() => {
        forceTick((n) => n + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [turnStartedAtMs, graceMs]);

  // serverNow(), not a bare Date.now() — same reasoning as computeLiveMs
  // below: turnStartedAtMs came from the server, so this needs the same
  // clock-offset correction or two players can see different grace
  // countdowns for the same actual deadline.
  const elapsedMs = serverNow() - turnStartedAtMs;
  const remainingMs = graceMs - elapsedMs;

  // Not yet 5s in, or already expired (the server-side timeout will resolve
  // the game momentarily), render nothing rather than a stale "0s".
  if (elapsedMs < 5000 || remainingMs <= 0) return null;

  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1 font-semibold text-red-400",
        size === "sm" ? "justify-center text-[10px]" : "text-xs",
      )}
      title="Move now: running out of time costs this game"
    >
      <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
      Move in {seconds}s
    </div>
  );
}

/**
 * Opponent-disconnected countdown, rendered in the panel's badge slot (same
 * place as FirstMoveBadge). Counts down the seconds until the game can be
 * claimed, then swaps to compact Win / Draw claim buttons. Owns its own
 * once-a-second tick so re-renders never reach past this badge (same reasoning as
 * ClockBadge / FirstMoveBadge).
 */
function DisconnectBadge({
  expiresAt,
  onClaim,
  size = "md",
}: {
  expiresAt: number;
  onClaim: (claim: "win" | "draw") => void;
  size?: "md" | "sm";
}) {
  const [, forceTick] = useState(0);

  // One timeout per displayed second (and one at expiry, to swap in the
  // claim buttons) instead of a 500ms poll. Date.now() is right here:
  // Game.tsx builds expiresAt as `Date.now() + graceMs` on THIS device
  // (the server only sends the duration), so both sides of the comparison
  // use the same local clock.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const left = expiresAt - Date.now();
      if (left <= 0) return; // already claimable
      timer = window.setTimeout(() => {
        forceTick((n) => n + 1);
        schedule();
      }, msUntilNextWholeSecond(left));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const remainingMs = Math.max(0, expiresAt - Date.now());
  const claimable = remainingMs <= 0;

  if (!claimable) {
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-1 font-semibold text-red-400",
          size === "sm" ? "justify-center text-[10px]" : "text-xs",
        )}
        title="Opponent disconnected. You can claim the game if they don't return."
      >
        <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
        <span className="truncate">
          Left · claim in {Math.ceil(remainingMs / 1000)}s
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1",
        size === "sm" && "flex-wrap justify-center",
      )}
    >
      <span className="shrink-0 text-xs font-semibold text-red-400">
        Claim:
      </span>
      <button
        type="button"
        onClick={() => onClaim("win")}
        title="Claim victory"
        className="h-4.5 shrink-0 rounded-md bg-red-500 px-1.5 text-[11px] font-semibold leading-none text-white transition-colors hover:bg-red-400"
      >
        Win
      </button>
      <button
        type="button"
        onClick={() => onClaim("draw")}
        title="Claim draw"
        className="h-4.5 shrink-0 rounded-md bg-base-300 px-1.5 text-[11px] font-semibold leading-none text-base-content/80 transition-colors hover:bg-base-300/70"
      >
        Draw
      </button>
    </div>
  );
}

/** Small badge icon shown right next to the clock once a side has
 *  berserked, a halved clock is a big deal, so it stays close to the thing
 *  it actually affects rather than living up with the game-level badges. */
function BerserkBadge({ size = "md" }: { size?: "md" | "sm" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400",
        size === "sm" ? "h-4 w-4" : "h-5 w-5",
      )}
      title="Berserked: clock halved for a bonus point if they win"
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
  // serverNow(), not a bare Date.now(): turnStartedAtMs is a timestamp the
  // SERVER generated, so counting down against this device's own
  // uncorrected clock only shows the same number on both players' screens
  // if their two system clocks happen to agree — nothing guarantees that,
  // and they measurably don't always. See clockSync.ts.
  return isTicking
    ? baseRemainingMs - (serverNow() - turnStartedAtMs)
    : baseRemainingMs;
}

/**
 * The actual ticking countdown badge, split out into its own component so
 * its re-renders (once a second, or every 100ms under the tenths cutoff,
 * while `isTicking`) are scoped to just this small node instead of the whole game page.
 *
 * This used to be a value (`liveMs`) computed in Game.tsx's render body
 * from a page-level 100ms `setInterval`, which meant every clock tick
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
  className,
  leading,
}: {
  baseRemainingMs: number | null;
  turnStartedAtMs: number;
  isTicking: boolean;
  isTurn: boolean;
  clockKnown: boolean;
  lowTimeThresholdMs: number;
  /** `bar` = full-width clock that sits flush against a player panel
   *  (md and up, see PlayerPanelWithClock). */
  size?: "md" | "sm" | "bar";
  className?: string;
  /** Rendered before the digits (the berserk badge, in bar mode). */
  leading?: ReactNode;
}) {
  const [, forceTick] = useState(0);

  // Self-rescheduling timeout instead of a fixed 100ms interval: it fires
  // only when the displayed text (or the low-time styling) can actually
  // change, once a second on the second boundary, then every 100ms only
  // below the tenths cutoff. See msUntilClockRepaint in chessUtils.ts.
  useEffect(() => {
    if (!isTicking || baseRemainingMs === null) return;
    let timer: number | undefined;
    const schedule = () => {
      const liveMs = computeLiveMs(baseRemainingMs, turnStartedAtMs, true);
      // Nothing left to count down (the server ends the game); stop.
      if (liveMs === null || liveMs <= 0) return;
      timer = window.setTimeout(() => {
        forceTick((n) => n + 1);
        schedule();
      }, msUntilClockRepaint(liveMs, lowTimeThresholdMs));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [isTicking, baseRemainingMs, turnStartedAtMs, lowTimeThresholdMs]);

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
        // No transition-colors, no animate-pulse: this badge re-renders
        // repeatedly while ticking (see this component's own doc
        // comment), so both the active/inactive color transition and the
        // low-time pulse were re-triggering constantly during play, not
        // just on the state changes they were meant for. David: flagged
        // as a likely contributor to move lag.
        size === "bar"
          ? "flex w-full items-center justify-center gap-2 px-3 py-1.5 font-mono text-2xl font-bold tabular-nums lg:text-3xl"
          : size === "sm"
          ? "rounded-md px-1.5 py-1 font-mono text-xs font-bold tabular-nums"
          : // A little bigger on phones, much bigger from md up where the
            // right-hand panel has the room (the row grows to match, see
            // PlayerPanelRow).
            "shrink-0 rounded-lg px-2.5 py-1 text-right font-mono text-base font-bold tabular-nums md:px-3 md:text-2xl lg:px-4 lg:py-1.5 lg:text-4xl",
        isLow
          ? "bg-red-500/15 text-red-500"
          : isTurn
            ? "gradient-brand text-white shadow-sm shadow-(--primary)/30"
            : "bg-base-300/60 text-base-content/80",
        className,
      )}
    >
      {leading}
      {clockKnown ? formatClock(liveMs ?? 0) : "∞"}
    </div>
  );
}

/** Wide horizontal row, avatar, name + captured tray, clock, all in a
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
  rating,
  zenMode,
  disconnect,
  score,
  hideClock,
  className,
}: PanelData & {
  /** The clock is rendered elsewhere (PlayerPanelWithClock attaches it
   *  flush above/below this row), so the row gives its space to the name. */
  hideClock?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-13.5 items-center gap-3 rounded-xl bg-base-200/70 px-3 py-2 text-base-content",
        hideClock ? "md:h-14 lg:h-16" : "md:h-16 lg:h-20",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-1">
      {score != null && <ScoreBadge score={score} />}
      {zenMode ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-base-300/70 text-base-content/40 md:h-8 md:w-8">
          <UserRound className="h-3 w-3 md:h-4 md:w-4" />
        </span>
      ) : profileHref ? (
        <Link to={profileHref} className="shrink-0">
          <Avatar
            username={username}
            gradient={avatarGradient}
            size="xs"
            mdSize="sm"
            status={connected ? "online" : "offline"}
          />
        </Link>
      ) : (
        <Avatar
          username={username}
          gradient={avatarGradient}
          size="xs"
          mdSize="sm"
          status={connected ? "online" : "offline"}
        />
      )}
      </div>
      {/* The second line (first-move countdown / disconnect claim / captured
       *  pieces) lives in a fixed-height slot that is ALWAYS rendered, empty
       *  or not. The row is a fixed height and this column is centred in it,
       *  so a slot that only appeared when it had content made the username
       *  jump up and down every capture. With the slot reserved the username
       *  never moves, and on phone (where this row is a flex sibling of the
       *  board, see GameBoardArea) the board never resizes either. */}
      <div className="min-w-0 flex-1">
        {zenMode ? (
          <p className="truncate text-sm font-semibold leading-5 text-base-content/40">
            Hidden
          </p>
        ) : profileHref ? (
          <Link
            to={profileHref}
            className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-5 text-base-content hover:text-(--primary)"
          >
            <span className="min-w-0 truncate">{username}</span>
          </Link>
        ) : (
          <p className="truncate text-sm font-semibold leading-5 text-base-content">
            {username}
          </p>
        )}
        <div className="flex h-4.5 min-w-0 items-center gap-1.5">
          {!zenMode && profileHref && <RatingBadge rating={rating ?? null} />}
          {disconnect ? (
            <DisconnectBadge
              expiresAt={disconnect.expiresAt}
              onClaim={disconnect.onClaim}
            />
          ) : firstMoveGraceMs !== null ? (
            <FirstMoveBadge
              turnStartedAtMs={turnStartedAtMs}
              graceMs={firstMoveGraceMs}
            />
          ) : (
            !zenMode && (
              <MaterialBadge
                pieceDiff={pieceDiff}
                glyphs={glyphs}
                advantage={advantage}
              />
            )
          )}
        </div>
      </div>
      {!hideClock && (
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
      )}
    </div>
  );
});

/** Desktop / tablet (md and up) player block: the clock is its own full-width
 *  bar sitting flush against the panel with NO gap (above the top player's
 *  panel, below the bottom player's), sharing its width and corner radius so
 *  it reads as one unit belonging to that player. Taking the clock out of the
 *  row is what stops a big clock squeezing the username away on narrow
 *  right-hand columns. Phones keep the inline PlayerPanelRow clock. */
export const PlayerPanelWithClock = memo(function PlayerPanelWithClock({
  position,
  ...panel
}: PanelData & { position: "top" | "bottom" }) {
  const bar = (
    <ClockBadge
      baseRemainingMs={panel.baseRemainingMs}
      turnStartedAtMs={panel.turnStartedAtMs}
      isTicking={panel.isTicking}
      isTurn={panel.isTurn}
      clockKnown={panel.clockKnown}
      lowTimeThresholdMs={panel.lowTimeThresholdMs}
      size="bar"
      className={position === "top" ? "rounded-t-xl" : "rounded-b-xl"}
      leading={panel.berserked ? <BerserkBadge /> : undefined}
    />
  );
  return (
    <div className="flex flex-col">
      {position === "top" && bar}
      <PlayerPanelRow
        {...panel}
        hideClock
        className={position === "top" ? "rounded-t-none" : "rounded-b-none"}
      />
      {position === "bottom" && bar}
    </div>
  );
});

/** Narrow vertical column, avatar/name/clock/captures stacked. Used to
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
  disconnect,
  score,
  className,
}: PanelData & { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-xl bg-base-200/70 px-1 py-2 text-center text-base-content sm:w-16",
        className,
      )}
    >
      <span className="relative inline-flex">
        {score != null && (
          <ScoreBadge
            score={score}
            className="absolute -left-2 -top-1.5 z-10 min-w-4 px-1 py-0 text-[10px]"
          />
        )}
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
      </span>
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
       *  slot, see its comment. */}
      <div className="min-h-3.5 w-full">
        {disconnect ? (
          <DisconnectBadge
            expiresAt={disconnect.expiresAt}
            onClaim={disconnect.onClaim}
            size="sm"
          />
        ) : firstMoveGraceMs !== null ? (
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

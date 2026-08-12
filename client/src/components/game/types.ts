import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
} from "../../sounds.js";

export interface GameMeta {
  _id: string;
  joinCode: string;
  variant: "standard" | "chess960";
  initialFen: string;
  white: { _id: string; username: string; avatarGradient?: any } | null;
  black: { _id: string; username: string; avatarGradient?: any } | null;
  status: "waiting" | "active" | "finished" | "aborted";
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  wagerTokens?: number;
  cageMatchId?: string | null;
  legIndex?: number | null;
  /** Populated with just the join code by getGameByCode — enough for a
   *  "Back to tournament" link without pulling the whole Tournament doc. */
  /** Populated with the join code (for the "Back to tournament" link) and
   *  name (shown on the in-game badge) by getGameByCode. */
  tournamentId?: { _id: string; code: string; name: string } | null;
}

export interface MoveLogEntry {
  moveNumber: number;
  san: string;
  from: string;
  to: string;
}

export type Role = "white" | "black" | "spectator";

/** A game is only ever "live" — i.e. worth opening a socket room for —
 *  while it's waiting for an opponent or actually being played. Once it's
 *  finished or aborted there's nothing left to sync in real time, so
 *  those two statuses are the "stale" side of the fixed /game/:code URL:
 *  same page, same layout, just filled in from the one-shot REST payload
 *  instead of a socket connection. See the fetch effect in Game.tsx. */
export function isLiveStatus(status: GameMeta["status"]) {
  return status === "waiting" || status === "active";
}

/** Picks the same check/capture/plain-move sound for a SAN string
 *  regardless of where the move came from — a live game:move event or
 *  just walking the move list during replay. Shared so the two call
 *  sites can't quietly drift apart. */
export function playSoundForMove(san: string | undefined) {
  if (!san) return;
  if (san.includes("+") || san.includes("#")) playCheckSound();
  else if (san.includes("x")) playCaptureSound();
  else playMoveSound();
}

export function describeResult(result: string | null): string {
  if (result === "white") return "White wins";
  if (result === "black") return "Black wins";
  if (result === "draw") return "Draw";
  return "Game aborted";
}

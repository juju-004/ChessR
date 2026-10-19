import type { MoveClass } from "../../lib/analysis/classify.js";

export interface MoveClassMeta {
  label: string;
  /** What follows "<san> is": reads naturally for every class
   *  ("a good move", "the best move", "a blunder", "a miss"). */
  phrase: string;
  /** Badge / tint color, picked to read like chess.com's markers. */
  color: string;
  /** One-line explanation shown under the board. */
  blurb: string;
}

export const MOVE_CLASS_META: Record<MoveClass, MoveClassMeta> = {
  brilliant: {
    label: "Brilliant",
    phrase: "a brilliant move",
    color: "#1baca6",
    blurb: "A sacrifice that actually works.",
  },
  great: {
    label: "Great",
    phrase: "a great move",
    color: "#5c8bb0",
    blurb: "The only move that keeps the position together.",
  },
  best: {
    label: "Best",
    phrase: "the best move",
    color: "#81b64c",
    blurb: "The engine's top choice.",
  },
  book: {
    label: "Book",
    phrase: "a book move",
    color: "#a88865",
    blurb: "A known opening move.",
  },
  good: {
    label: "Good",
    phrase: "a good move",
    color: "#95b776",
    blurb: "A solid move.",
  },
  bad: {
    label: "Bad",
    phrase: "a bad move",
    color: "#ff7769",
    blurb: "A weak move, a clearly better one was available.",
  },
  miss: {
    label: "Miss",
    phrase: "a miss",
    color: "#ff7769",
    blurb: "You let your opponent's mistake go unpunished.",
  },
  blunder: {
    label: "Blunder",
    phrase: "a blunder",
    color: "#ca3431",
    blurb: "This move gave away a lot.",
  },
};

import { useEffect, useMemo, useRef, useState } from "react";
import { StockfishEngine, type PositionEval } from "../lib/analysis/engine.js";
import { bookKey, loadOpeningBook, type BookSet } from "../lib/analysis/openingBook.js";
import {
  classifyMove,
  moveLoss,
  terminalEval,
  type MoveClassification,
} from "../lib/analysis/classify.js";

/** Search depth per position. 12 is plenty for sorting moves into these
 *  buckets on a computer... */
export const ANALYSIS_DEPTH = 12;
/** ...and phones get a shallower search, since one slow core has to do all
 *  the work (roughly 2-3x faster, move ratings barely change). */
export const ANALYSIS_DEPTH_MOBILE = 10;

function pickDepth(): number {
  try {
    return window.matchMedia("(max-width: 767px)").matches
      ? ANALYSIS_DEPTH_MOBILE
      : ANALYSIS_DEPTH;
  } catch {
    return ANALYSIS_DEPTH;
  }
}

const CACHE_PREFIX = "chessr:analysis:v1:";
const CACHE_INDEX = "chessr:analysis:v1:index";
const CACHE_MAX_GAMES = 20;

export interface AnalysisMove {
  from: string;
  to: string;
  promotion?: string;
}

export interface UseGameAnalysisInput {
  /** Stable id for caching (the game's _id). */
  gameId: string;
  /** Position 0 .. N: the start position followed by every move's fenAfter. */
  fens: string[];
  moves: AnalysisMove[];
  chess960: boolean;
}

export interface GameAnalysis {
  status: "running" | "done" | "error";
  /** Positions evaluated so far / total positions. */
  done: number;
  total: number;
  /** evals[i] is the evaluation of fens[i], undefined until computed. */
  evals: Array<PositionEval | undefined>;
  /** classes[i] is the verdict on moves[i], null until both neighbours exist. */
  classes: Array<MoveClassification | null>;
}

function readCache(gameId: string, fens: string[]): PositionEval[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + gameId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PositionEval[];
    if (!Array.isArray(parsed) || parsed.length !== fens.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(gameId: string, evals: PositionEval[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + gameId, JSON.stringify(evals));
    const index: string[] = JSON.parse(localStorage.getItem(CACHE_INDEX) ?? "[]");
    const next = [gameId, ...index.filter((id) => id !== gameId)];
    for (const old of next.slice(CACHE_MAX_GAMES)) {
      localStorage.removeItem(CACHE_PREFIX + old);
    }
    localStorage.setItem(CACHE_INDEX, JSON.stringify(next.slice(0, CACHE_MAX_GAMES)));
  } catch {
    /* storage full or unavailable, analysis just re-runs next visit */
  }
}

/**
 * Runs Stockfish over every position of a game, one after another, and
 * classifies each move as results arrive (so the board is usable while the
 * rest is still being crunched). Finished analyses are cached in
 * localStorage so reopening a game is instant.
 */
export function useGameAnalysis(input: UseGameAnalysisInput | null): GameAnalysis | null {
  const [evals, setEvals] = useState<Array<PositionEval | undefined>>([]);
  const [status, setStatus] = useState<GameAnalysis["status"]>("running");
  const engineRef = useRef<StockfishEngine | null>(null);
  const [book, setBook] = useState<BookSet | null>(null);

  // Lazy-loaded once; classification waits for it so a move never flips
  // from "good" to "book" a moment after it appears.
  useEffect(() => {
    let alive = true;
    loadOpeningBook()
      .then((b) => alive && setBook(b))
      .catch(() => alive && setBook(new Set()));
    return () => {
      alive = false;
    };
  }, []);

  const key = input ? `${input.gameId}:${input.fens.length}` : null;
  // The engine run waits for the opening book so it knows which positions
  // it can skip.
  const bookReady = book !== null;

  useEffect(() => {
    if (!input || !book) return;
    let cancelled = false;
    const { gameId, fens, chess960 } = input;
    const depth = pickDepth();
    // Position k is "in book" when it is the start position or a known
    // opening position. An engine run is only needed for a position if it
    // sits next to a non-book one, so a long run of book moves costs nothing.
    const isBookPos = (k: number) =>
      k === 0 || (!chess960 && book.has(bookKey(fens[k])));
    const skippable = (k: number) =>
      k < fens.length - 1 && isBookPos(k) && isBookPos(k + 1);

    const cached = readCache(gameId, fens);
    if (cached) {
      setEvals(cached);
      setStatus("done");
      return;
    }

    setEvals(new Array(fens.length).fill(undefined));
    setStatus("running");

    const engine = new StockfishEngine();
    engineRef.current = engine;

    (async () => {
      try {
        await engine.init(chess960);
        const results: PositionEval[] = [];
        for (let i = 0; i < fens.length; i++) {
          if (cancelled) return;
          const fen = fens[i];
          const terminal = terminalEval(fen);
          const result: PositionEval = terminal
            ? terminal
            : skippable(i)
              ? // Placeholder (level) eval for an opening position: nothing
                // reads it for a rating, it only keeps the eval bar neutral.
                { fen, lines: [{ cpWhite: 0, mate: null, pv: [] }] }
              : { fen, lines: await engine.analyse(fen, depth) };
          results.push(result);
          if (cancelled) return;
          setEvals((prev) => {
            const next = prev.slice();
            next[i] = result;
            return next;
          });
        }
        writeCache(gameId, results);
        if (!cancelled) setStatus("done");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      engine.destroy();
      engineRef.current = null;
    };
    // `key` covers gameId + length; fens/moves are derived from the same game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bookReady]);

  const classes = useMemo(() => {
    if (!input) return [];
    return input.moves.map((m, i) => {
      if (!book) return null;
      const isBook = !input.chess960 && book.has(bookKey(input.fens[i + 1]));
      // Opening moves are rated "book" without needing any engine result.
      if (isBook) {
        const verdict: MoveClassification = {
          cls: "book",
          loss: 0,
          bestUci: null,
          playedWasBest: false,
        };
        return verdict;
      }
      const before = evals[i];
      const after = evals[i + 1];
      if (!before || !after) return null;
      // The opponent's previous move only counts as an error to punish if it
      // was actually searched (not a skipped opening position).
      const prevWasBook =
        i === 0 || (!input.chess960 && book.has(bookKey(input.fens[i])));
      return classifyMove(before, after, m, {
        isBook: false,
        prevTo: i > 0 ? input.moves[i - 1].to : undefined,
        prevLoss:
          !prevWasBook && evals[i - 1] ? moveLoss(evals[i - 1]!, before) : undefined,
      });
    });
  }, [evals, input, book]);

  if (!input) return null;
  return {
    status,
    done: evals.filter(Boolean).length,
    total: input.fens.length,
    evals,
    classes,
  };
}

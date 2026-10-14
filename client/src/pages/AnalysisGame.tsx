import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Chess } from "chess.js";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FlipVertical,
} from "lucide-react";
import { Page, Card, Avatar, Button, Spinner } from "../components/ui/index.js";
import { PageError } from "../components/PageError.js";
import { AnalysisBoard } from "../components/analysis/AnalysisBoard.js";
import { EvalBar } from "../components/analysis/EvalBar.js";
import { MoveBadge } from "../components/analysis/MoveBadge.js";
import { AnalysisDrawer } from "../components/analysis/AnalysisDrawer.js";
import { AnalysisActionBarMobile } from "../components/analysis/AnalysisActionBarMobile.js";
import { MOVE_CLASS_META } from "../components/analysis/moveClassMeta.js";
import { getGameByCode } from "../api/games.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useSettings } from "../contexts/SettingsContext.js";
import { useGameAnalysis } from "../hooks/useGameAnalysis.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import {
  MOVE_CLASSES,
  sideAccuracy,
  type MoveClass,
  type MoveClassification,
} from "../lib/analysis/classify.js";
import { errMsg } from "../lib/errMsg.js";
import { cn } from "../lib/cn.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface GameMove {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  fenAfter: string;
}

interface Side {
  _id: string;
  username: string;
  avatarGradient?: string | null;
}

interface LoadedGame {
  _id: string;
  variant: "standard" | "chess960";
  initialFen?: string;
  status: string;
  white: Side;
  black: Side | null;
  moves: GameMove[];
}

/** Engine review of one finished game, at /analysis/:code. */
export function AnalysisGame() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const { settings } = useSettings();

  const [game, setGame] = useState<LoadedGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Phones get the verdict above the board and the rest in a drawer;
  // md and up keep everything in the side column.
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setGame(null);
    setError(null);
    getGameByCode(code)
      .then(({ game }) => {
        if (cancelled) return;
        setGame(game as LoadedGame);
        setPly(0);
        // Open from the viewer's own side of the board.
        setFlipped(game.black?._id === user?.id && game.white?._id !== user?.id);
      })
      .catch((err) => !cancelled && setError(errMsg(err)));
    return () => {
      cancelled = true;
    };
    // user?.id only seeds the initial orientation, no refetch when it settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const initialFen = game?.initialFen || START_FEN;
  const fens = useMemo(
    () => (game ? [initialFen, ...game.moves.map((m) => m.fenAfter)] : []),
    [game, initialFen],
  );

  const analysisInput = useMemo(
    () =>
      game && game.moves.length > 0
        ? {
            gameId: game._id,
            fens,
            moves: game.moves.map((m) => ({ from: m.from, to: m.to, promotion: m.promotion })),
            chess960: game.variant === "chess960",
          }
        : null,
    [game, fens],
  );
  const analysis = useGameAnalysis(analysisInput);

  const total = game?.moves.length ?? 0;
  const go = useCallback((next: number) => setPly(Math.max(0, Math.min(total, next))), [total]);

  // Arrow keys / Home / End step through the game.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") go(ply - 1);
      else if (e.key === "ArrowRight") go(ply + 1);
      else if (e.key === "ArrowUp" || e.key === "Home") go(0);
      else if (e.key === "ArrowDown" || e.key === "End") go(total);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, ply, total]);

  if (error) {
    return (
      <Page title="Game analysis" back="/analysis">
        <PageError message={error} />
      </Page>
    );
  }
  if (!game) {
    return (
      <Page title="Game analysis" back="/analysis">
        <div className="flex justify-center py-16">
          <Spinner size="sm" className="text-base-content/40" />
        </div>
      </Page>
    );
  }
  if (total === 0) {
    return (
      <Page title="Game analysis" back="/analysis">
        <Card>
          <p className="py-6 text-center text-sm text-base-content/60">
            This game has no moves to analyze.
          </p>
        </Card>
      </Page>
    );
  }

  const orientation: "white" | "black" = flipped ? "black" : "white";
  const fen = fens[ply];
  const move = ply > 0 ? game.moves[ply - 1] : null;
  const verdict = ply > 0 ? analysis?.classes[ply - 1] ?? null : null;
  const lastMove: [string, string] | undefined = move ? [move.from, move.to] : undefined;

  let inCheck = false;
  try {
    inCheck = new Chess(fen).inCheck();
  } catch {
    /* odd chess960 fen: skip the check glow */
  }
  const turnColor: "white" | "black" = fen.split(" ")[1] === "b" ? "black" : "white";

  // Counts per side. Move i was played by whoever was to move in fens[i].
  const counts = { w: emptyCounts(), b: emptyCounts() };
  const bySide: { w: MoveClassification[]; b: MoveClassification[] } = { w: [], b: [] };
  analysis?.classes.forEach((c, i) => {
    if (!c) return;
    const side = fens[i].split(" ")[1] === "b" ? "b" : "w";
    counts[side][c.cls]++;
    bySide[side].push(c);
  });
  // Only shown once every move is rated, so the number doesn't wobble
  // while the engine is still working through the game.
  const accuracy =
    analysis?.status === "done"
      ? { w: sideAccuracy(bySide.w), b: sideAccuracy(bySide.b) }
      : { w: null, b: null };

  const top = orientation === "white" ? game.black : game.white;
  const bottom = orientation === "white" ? game.white : game.black;

  const bestSan =
    verdict && (verdict.cls === "miss" || verdict.cls === "bad" || verdict.cls === "blunder") && verdict.bestUci
      ? uciToSan(fens[ply - 1], verdict.bestUci)
      : null;

  const running = analysis?.status === "running";

  const verdictCard = (
    <Card>
      <div className="min-h-[3.25rem]">
        {move && verdict ? (
          <div className="flex items-center gap-3">
            <MoveBadge cls={verdict.cls} size={28} />
            <div className="min-w-0">
              <p className="font-semibold text-base-content">
                {move.san} is{" "}
                <span style={{ color: MOVE_CLASS_META[verdict.cls].color }}>
                  a {MOVE_CLASS_META[verdict.cls].label.toLowerCase()}
                </span>
              </p>
              <p className="text-xs text-base-content/50">
                {bestSan ? `Best was ${bestSan}.` : MOVE_CLASS_META[verdict.cls].blurb}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-base-content/50">
            {move
              ? "Analyzing this move…"
              : running
                ? "Analyzing the game…"
                : "Step through the moves to see how each one was rated."}
          </p>
        )}
      </div>

      {running && analysis && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-base-300">
            <div
              className="h-full rounded-full bg-(--primary) transition-[width] duration-200"
              style={{ width: `${(analysis.done / analysis.total) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-base-content/40">
            Analyzing {analysis.done}/{analysis.total}
          </p>
        </div>
      )}
      {analysis?.status === "error" && (
        <p className="mt-3 text-xs text-red-500">
          The engine could not start. Check that /stockfish/ files are deployed.
        </p>
      )}
    </Card>
  );

  const summaryCard = (
    <Card>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <AccuracyTile label="White" value={accuracy.w} />
        <AccuracyTile label="Black" value={accuracy.b} />
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1.5 text-sm">
        <span />
        <span className="text-center text-xs font-semibold text-base-content/50">White</span>
        <span className="text-center text-xs font-semibold text-base-content/50">Black</span>
        {MOVE_CLASSES.map((cls) => (
          <SummaryRow key={cls} cls={cls} white={counts.w[cls]} black={counts.b[cls]} />
        ))}
      </div>
    </Card>
  );

  const movesCard = (
    <Card className="p-2">
      <MoveList
        moves={game.moves}
        classes={analysis?.classes ?? []}
        ply={ply}
        onSelect={(next) => {
          go(next);
          // On a phone the list lives in the drawer, so jumping to a move
          // should reveal the board again.
          setDrawerOpen(false);
        }}
        maxHeightClass={isDesktop ? "max-h-72 lg:max-h-[24rem]" : "max-h-[55vh]"}
      />
    </Card>
  );

  return (
    // Bottom padding on phones keeps the last row clear of the fixed docker.
    <Page title="Game analysis" back="/analysis" className="pb-24! md:pb-10! lg:max-w-6xl!">
      {!isDesktop && <div className="mb-3">{verdictCard}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Board column */}
        <div className="min-w-0">
          <PlayerStrip
            side={top}
            color={orientation === "white" ? "black" : "white"}
            accuracy={orientation === "white" ? accuracy.b : accuracy.w}
          />
          <div className="my-2 flex items-stretch gap-2">
            <EvalBar
              line={analysis?.evals[ply]?.lines[0]}
              orientation={orientation}
            />
            <div className="min-w-0 flex-1">
              <AnalysisBoard
                fen={fen}
                orientation={orientation}
                lastMove={lastMove}
                verdict={verdict?.cls ?? null}
                boardTheme={settings.boardTheme}
                pieceTheme={settings.pieceTheme}
                showCoordinates={settings.showCoordinates}
                animationEnabled={settings.pieceAnimation}
                inCheck={inCheck}
                turnColor={turnColor}
              />
            </div>
          </div>
          <PlayerStrip
            side={bottom}
            color={orientation}
            accuracy={orientation === "white" ? accuracy.w : accuracy.b}
          />

          <div className="mt-3 flex items-center justify-center gap-2">
            <Button variant="glass" size="sm" onClick={() => go(0)} disabled={ply === 0} aria-label="First move">
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="glass" size="sm" onClick={() => go(ply - 1)} disabled={ply === 0} aria-label="Previous move">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="glass" size="sm" onClick={() => go(ply + 1)} disabled={ply === total} aria-label="Next move">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="glass" size="sm" onClick={() => go(total)} disabled={ply === total} aria-label="Last move">
              <ChevronsRight className="h-4 w-4" />
            </Button>
            {/* The docker has its own flip button on phones. */}
            {isDesktop && (
              <Button variant="glass" size="sm" onClick={() => setFlipped((f) => !f)} aria-label="Flip board">
                <FlipVertical className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {isDesktop && (
          <div className="flex min-w-0 flex-col gap-4">
            {verdictCard}
            {summaryCard}
            {movesCard}
          </div>
        )}
      </div>

      {!isDesktop && (
        <>
          <AnalysisActionBarMobile
            onFlip={() => setFlipped((f) => !f)}
            onOpenDetails={() => setDrawerOpen(true)}
          />
          <AnalysisDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Summary and moves">
            {summaryCard}
            {movesCard}
          </AnalysisDrawer>
        </>
      )}
    </Page>
  );
}

function emptyCounts(): Record<MoveClass, number> {
  return { brilliant: 0, great: 0, best: 0, book: 0, good: 0, bad: 0, miss: 0, blunder: 0 };
}

function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return m.san;
  } catch {
    return null;
  }
}

function PlayerStrip({
  side,
  color,
  accuracy,
}: {
  side: Side | null;
  color: "white" | "black";
  accuracy: number | null;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Avatar username={side?.username ?? "?"} size="xs" gradient={side?.avatarGradient} />
      <span className="truncate text-sm font-medium text-base-content">
        {side?.username ?? "Unknown"}
      </span>
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full border border-base-content/30",
          color === "white" ? "bg-white" : "bg-black",
        )}
      />
      {accuracy !== null && (
        <span className="ml-auto rounded-full bg-base-300 px-2 py-0.5 text-xs font-semibold tabular-nums text-base-content/80">
          {accuracy.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function AccuracyTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-base-300/60 px-3 py-2 text-center">
      <p className="text-xs font-semibold text-base-content/50">{label} accuracy</p>
      <p className="text-xl font-bold tabular-nums text-base-content">
        {value === null ? "–" : `${value.toFixed(1)}%`}
      </p>
    </div>
  );
}

function SummaryRow({ cls, white, black }: { cls: MoveClass; white: number; black: number }) {
  const meta = MOVE_CLASS_META[cls];
  return (
    <>
      <span className="flex items-center gap-2 text-base-content/80">
        <MoveBadge cls={cls} size={16} />
        {meta.label}
      </span>
      <span className="text-center font-semibold tabular-nums" style={{ color: white ? meta.color : undefined }}>
        {white}
      </span>
      <span className="text-center font-semibold tabular-nums" style={{ color: black ? meta.color : undefined }}>
        {black}
      </span>
    </>
  );
}

function MoveList({
  moves,
  classes,
  ply,
  onSelect,
  maxHeightClass,
}: {
  moves: GameMove[];
  classes: Array<{ cls: MoveClass } | null>;
  ply: number;
  onSelect: (ply: number) => void;
  maxHeightClass: string;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Keep the selected move in view without scrolling the whole page.
  useEffect(() => {
    const el = activeRef.current;
    const box = scrollerRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: top - box.clientHeight / 2, behavior: "smooth" });
    }
  }, [ply]);

  const rows: number[] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push(i);

  function cell(i: number) {
    const m = moves[i];
    if (!m) return <span />;
    const active = ply === i + 1;
    const c = classes[i];
    return (
      <button
        type="button"
        ref={active ? activeRef : undefined}
        onClick={() => onSelect(i + 1)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors",
          active ? "bg-(--primary)/15 font-semibold text-base-content" : "text-base-content/80 hover:bg-base-300",
        )}
      >
        <span className="truncate">{m.san}</span>
        {c && <MoveBadge cls={c.cls} size={14} />}
      </button>
    );
  }

  return (
    <div ref={scrollerRef} className={cn("relative overflow-y-auto", maxHeightClass)}>
      {rows.map((i) => (
        <div key={i} className="grid grid-cols-[2rem_1fr_1fr] items-center">
          <span className="pl-2 text-xs text-base-content/40">{i / 2 + 1}</span>
          {cell(i)}
          {cell(i + 1)}
        </div>
      ))}
    </div>
  );
}

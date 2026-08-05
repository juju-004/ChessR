import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Share2, ChevronLeft, ChevronRight, FlipVertical2 } from "lucide-react";
import { getGameByCode } from "../api/games.js";
import { ApiRequestError } from "../api/http.js";
import { ChessBoard } from "../components/ChessBoard.js";
import { MoveList, MoveStrip } from "../components/MoveLog.js";
import { PlayerPanelRow, panelMaterial } from "../components/PlayerPanels.js";
import {
  Card,
  Button,
  Badge,
  Spinner,
  Tooltip,
} from "../components/ui/index.js";
import { useSettings } from "../contexts/SettingsContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { formatTimeControl } from "../timeControls.js";
import { computeMaterialDiff } from "../chessUtils.js";
import { springSnappy } from "../lib/motion.js";
import { copyToClipboard } from "@/lib/utils.js";

interface ReplayMove {
  san: string;
  from: string;
  to: string;
  fenAfter: string;
  moveNumber: number;
}

interface ReplayPlayer {
  _id: string;
  username: string;
  avatarGradient?: string | null;
}

interface ReplayGame {
  _id: string;
  joinCode: string;
  white: ReplayPlayer;
  black: ReplayPlayer;
  result: string | null;
  endReason: string | null;
  variant: "standard" | "chess960";
  wagerTokens: number;
  initialFen: string;
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  moves: ReplayMove[];
}

const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? "http://localhost:5173";

function describeResult(game: ReplayGame): string {
  if (game.result === "draw") return "Draw";
  if (game.result === "white") return `${game.white.username} won`;
  if (game.result === "black") return `${game.black.username} won`;
  return "Game aborted";
}

/**
 * Deliberately built to *look* like Game.tsx (same .game-grid layout,
 * PlayerPanelRow/Flank, Card, action-button row) rather than share code
 * with it — Game.tsx is wall-to-wall live socket state, and this page has
 * none of that: it fetches the finished game once and just replays the
 * move list that's already sitting in `moves[].fenAfter`. No socket
 * connection is ever opened here.
 */
export function GameReplay() {
  const { code = "" } = useParams<{ code: string }>();
  const { settings } = useSettings();
  const { user } = useAuth();
  const { notify, dismiss } = useNotify();
  const [game, setGame] = useState<ReplayGame | null>(null);
  const [error, setError] = useState("");
  // -1 = starting position, before any move has been played.
  const [ply, setPly] = useState(-1);
  const [boardFlipped, setBoardFlipped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGame(null);
    setError("");
    setPly(-1);
    getGameByCode(code)
      .then(({ game }: { game: ReplayGame }) => {
        if (cancelled) return;
        setGame(game);
        setPly(game.moves.length > 0 ? game.moves.length - 1 : -1);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiRequestError ? err.message : "Game not found",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="mx-auto mt-6 max-w-2xl px-4">
        <Card
          variant="solid"
          className="border-red-900/50 bg-red-950/20 text-red-300"
        >
          {error}
        </Card>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

  const current = ply >= 0 ? game.moves[ply] : null;
  const displayFen = current?.fenAfter ?? game.initialFen;
  const lastMove: [string, string] | undefined = current
    ? [current.from, current.to]
    : undefined;

  const myColor: "white" | "black" | null =
    user?.id === game.white._id
      ? "white"
      : user?.id === game.black._id
        ? "black"
        : null;
  const orientation = boardFlipped
    ? myColor === "black"
      ? "white"
      : "black"
    : (myColor ?? "white");

  // Memoized on displayFen alone — computeMaterialDiff/panelMaterial return
  // fresh objects every call, which would otherwise give whitePanelData/
  // blackPanelData's own useMemo below a "changed" input on every render
  // regardless of whether the displayed position actually moved.
  const material = useMemo(() => computeMaterialDiff(displayFen), [displayFen]);
  const whiteMaterial = useMemo(() => panelMaterial("white", material), [material]);
  const blackMaterial = useMemo(() => panelMaterial("black", material), [material]);

  // Every field a PlayerPanel needs to *tick* is nulled out/false here —
  // there's no live clock in a replay, so ClockBadge just renders "∞"
  // instead of a time (clockKnown: false), same as an untimed game would.
  // Memoized so PlayerPanelRow's React.memo isn't defeated by a fresh object
  // reference on every unrelated re-render (flip board, prev/next, etc).
  const whitePanelData = useMemo(
    () => ({
      username: game.white.username,
      avatarGradient: game.white.avatarGradient,
      isTurn: false,
      connected: true,
      baseRemainingMs: null,
      turnStartedAtMs: 0,
      isTicking: false,
      clockKnown: false,
      lowTimeThresholdMs: 0,
      ...whiteMaterial,
    }),
    [game.white.username, game.white.avatarGradient, whiteMaterial],
  );
  const blackPanelData = useMemo(
    () => ({
      username: game.black.username,
      avatarGradient: game.black.avatarGradient,
      isTurn: false,
      connected: true,
      baseRemainingMs: null,
      turnStartedAtMs: 0,
      isTicking: false,
      clockKnown: false,
      lowTimeThresholdMs: 0,
      ...blackMaterial,
    }),
    [game.black.username, game.black.avatarGradient, blackMaterial],
  );
  const myPanelData = myColor === "black" ? blackPanelData : whitePanelData;
  const opponentPanelData =
    myColor === "black" ? whitePanelData : blackPanelData;

  const handleSelectPly = useCallback((i: number) => {
    setPly(i);
  }, []);
  // MoveList/MoveStrip are shared with Game.tsx and key off a 1-indexed
  // `moveNumber` (matching m.moveNumber on each move), whereas replay's
  // `ply` is a 0-indexed array position with -1 meaning "before any move" —
  // hence the +1/-1 conversions at the boundary here rather than changing
  // either component's own indexing convention.
  const handleSelectMoveNumber = useCallback(
    (moveNumber: number) => handleSelectPly(moveNumber - 1),
    [handleSelectPly],
  );
  function handlePrev() {
    setPly((p) => Math.max(-1, p - 1));
  }
  function handleNext() {
    setPly((p) => Math.min(game!.moves.length - 1, p + 1));
  }
  function handleShare() {
    copyToClipboard(`${CLIENT_URL}/replay/${game!.joinCode}`);
    const n = notify("Copied game url");
    setTimeout(() => dismiss(n), 2000);
  }

  const badges = [];
  if (game.variant === "chess960")
    badges.push(
      <Badge key="960" variant="secondary">
        Chess960
      </Badge>,
    );
  if (game.wagerTokens)
    badges.push(
      <Badge key="wager" variant="warning">
        {game.wagerTokens} R wager
      </Badge>,
    );

  const actionItems = [
    {
      label: boardFlipped ? "Unflip board" : "Flip board",
      icon: FlipVertical2,
      onClick: () => setBoardFlipped((f) => !f),
    },
    {
      label: "Previous move",
      icon: ChevronLeft,
      onClick: handlePrev,
      disabled: ply === -1,
    },
    {
      label: "Next move",
      icon: ChevronRight,
      onClick: handleNext,
      disabled: ply >= game.moves.length - 1,
    },
  ];

  const moveListEntries =
    game.moves.length === 0 ? null : (
      <MoveList moves={game.moves} currentPly={ply + 1} onSelectMove={handleSelectMoveNumber} />
    );
  const moveStripEntries =
    game.moves.length === 0 ? null : (
      <MoveStrip moves={game.moves} currentPly={ply + 1} onSelectMove={handleSelectMoveNumber} />
    );

  return (
    // No horizontal padding here below md — AppShell's own px-4 already insets
    // the whole page; adding px-3 on top of that (the old value) was double
    // padding the board along with everything else, which is exactly why it
    // couldn't reach full viewport width like Game.tsx's board does. From md
    // up the board is a fixed px size inside the grid anyway, so px-4 there
    // is just normal breathing room for the rest of the layout, same as before.
    <div className="mx-auto max-w-6xl min-h-[calc(100dvh-7rem)] flex flex-col justify-center py-3 md:px-4">
      <div className="game-grid">
        <div className="game-area-leftinfo flex shrink-0 flex-col justify-center gap-3 lg:h-full lg:min-h-0">
          <Card variant="solid">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-bold text-base-content">
                  Replay{" "}
                  <span className="font-normal text-base-content/40">
                    · {game.joinCode}
                  </span>
                </h1>
                <motion.button
                  type="button"
                  onClick={handleShare}
                  whileTap={{ scale: 0.9 }}
                  transition={springSnappy}
                  className="glass relative flex size-7 items-center justify-center rounded-full text-base-content/80 hover:text-base-content"
                >
                  <Share2 className="size-4" />
                </motion.button>
                {badges.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {badges}
                  </div>
                )}
              </div>
              <span className="mb-4 flex items-center gap-1.5 text-xs font-medium text-base-content/60">
                {formatTimeControl(game.timeControl)} · {describeResult(game)}
                {game.endReason
                  ? ` · ${game.endReason.replace(/_/g, " ")}`
                  : ""}
              </span>
            </div>

            <div className="min-h-0 lg:flex lg:flex-col">
              <h2 className="mt-3 hidden text-sm font-semibold text-base-content/40 lg:flex">
                Moves
              </h2>
              <div className="hidden max-h-40 min-h-0 overflow-y-auto pr-1 lg:block lg:flex-1">
                {moveListEntries ?? (
                  <p className="text-sm text-base-content/40">
                    No moves played.
                  </p>
                )}
              </div>
              <div className="lg:hidden">{moveStripEntries}</div>
            </div>
          </Card>
        </div>

        <div className="game-area-board relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center">
          <div className="game-area-toppanel w-[95%] md:hidden">
            <PlayerPanelRow {...opponentPanelData} />
          </div>
          <div
            // Same full-bleed breakout as Game.tsx's board (see the comment
            // there): -mx-4 + w-[calc(100%+2rem)] cancels out AppShell's
            // px-4 (1rem/side) so the board alone spans the full viewport
            // width on phone, without affecting the info card or panels
            // around it. 2rem = 1rem-per-side; keep in sync if App.tsx's
            // px-4 ever changes. md:mx-0 md:w-full resets to normal in-flow
            // sizing once the board becomes a fixed px size in the grid.
            className={`relative aspect-square min-h-60 min-w-60 max-w-full -mx-4 w-[calc(100%+2rem)] overflow-hidden rounded-2xl shadow-lg md:mx-0 md:h-auto md:max-h-full md:w-full board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme}`}
          >
            <ChessBoard
              fen={displayFen}
              orientation={orientation}
              viewOnly
              turnColor="white"
              dests={new Map()}
              lastMove={lastMove}
              onUserMove={() => {}}
              animationEnabled={settings.pieceAnimation}
              showCoordinates={settings.showCoordinates}
              showLegalMoves={settings.showLegalMoves}
            />
          </div>
          <div className="game-area-bottompanel w-[95%] md:hidden">
            <PlayerPanelRow {...myPanelData} />
          </div>
        </div>

        <div className="game-area-rightpanel min-h-0 flex-col justify-center gap-3">
          <Card variant="solid" className="shrink-0 space-y-2">
            <PlayerPanelRow {...opponentPanelData} />
            <PlayerPanelRow {...myPanelData} />
          </Card>

          <div className=" flex flex-wrap justify-center gap-2 pt-2">
            {actionItems.map((item) => (
              <Tooltip content={item.label} key={item.label}>
                <Button
                  variant="glass"
                  onClick={item.onClick}
                  disabled={item.disabled}
                >
                  <item.icon className="h-4 w-4" />
                </Button>
              </Tooltip>
            ))}
          </div>

          <Link
            to={`/game/${game.joinCode}`}
            className="text-center w-full text-xs text-base-content/40 hover:text-(--primary)"
          >
            Go to live game page →
          </Link>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap justify-center gap-2 md:hidden">
        {actionItems.map((item) => (
          <Tooltip content={item.label} key={item.label}>
            <Button
              variant="glass"
              onClick={item.onClick}
              disabled={item.disabled}
            >
              <item.icon className="h-4 w-4" />
            </Button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

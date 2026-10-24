import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { ChessBoard } from "../ChessBoard.js";
import { Card } from "../ui/index.js";
import { RatingBadge } from "../RatingBadge.js";
import { useSocket } from "../../contexts/SocketContext.js";
import { useSettings } from "../../contexts/SettingsContext.js";
import { useIsDesktop } from "../../hooks/useIsDesktop.js";
import { chessFen } from "../../chessUtils.js";
import { gameHref } from "../../lib/gamePath.js";
import { cn } from "@/lib/cn.js";
import {
  getTournamentLiveGames,
  type TournamentLiveGame,
} from "../../api/tournaments.js";

// A board that is only ever looked at: nothing is movable, so one shared
// empty map keeps ChessBoard's props referentially stable.
const NO_DESTS = new Map<string, string[]>();
const noop = () => undefined;

/** m:ss, or h:mm:ss from an hour up. Whole seconds, this is a thumbnail, not
 *  the game page's decisecond clock. */
function formatLiveClock(ms: number | null): string {
  if (ms == null) return "∞";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function remainingNow(
  game: TournamentLiveGame,
  color: "white" | "black",
  now: number,
): number | null {
  const base = color === "white" ? game.whiteRemainingMs : game.blackRemainingMs;
  if (base == null) return null;
  // Only the side to move is burning time, and not while the clocks are held.
  if (game.paused || game.turn !== color) return base;
  return Math.max(0, base - Math.max(0, now - game.turnStartedAtMs));
}

function PlayerStrip({
  game,
  color,
  now,
}: {
  game: TournamentLiveGame;
  color: "white" | "black";
  now: number;
}) {
  const p = game[color];
  const ticking = game.turn === color && !game.paused;
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full border border-base-content/30",
            color === "white" ? "bg-white" : "bg-neutral-800",
          )}
        />
        <span className="truncate">{p.username}</span>
        <RatingBadge rating={p.rating} />
      </span>
      <span
        className={cn(
          "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums",
          ticking
            ? "bg-(--secondary)/15 text-(--secondary)"
            : "bg-base-300/60 text-base-content/70",
        )}
      >
        {formatLiveClock(remainingNow(game, color, now))}
      </span>
    </div>
  );
}

function LiveBoard({ game, now }: { game: TournamentLiveGame; now: number }) {
  const { settings } = useSettings();
  const turnColor = game.turn;
  const body = (
    <div className="space-y-1.5">
      <PlayerStrip game={game} color="black" now={now} />
      {/* ChessBoard sizes itself to its parent, so the parent is the square. */}
      <div
        className={cn(
          "board-theme-" + settings.boardTheme,
          "piece-theme-" + settings.pieceTheme,
          "flex aspect-square w-full items-center justify-center overflow-hidden rounded-md",
        )}
      >
        <ChessBoard
          fen={chessFen(game.fen)}
          orientation="white"
          viewOnly
          turnColor={turnColor}
          dests={NO_DESTS}
          lastMove={game.lastMove ?? undefined}
          onUserMove={noop}
          animationDurationMs={150}
          showCoordinates={false}
          showLegalMoves={false}
        />
      </div>
      <PlayerStrip game={game} color="white" now={now} />
    </div>
  );
  return game.joinCode ? (
    <Link
      to={gameHref(game.joinCode)}
      aria-label={`Watch ${game.white.username} vs ${game.black.username}`}
      className="block rounded-lg transition-opacity hover:opacity-90"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * The tournament's top live game(s) as small view-only boards: the pairings
 * whose players have the most points between them. One board on phones (it
 * sits under the standings), two on desktop (beside them).
 *
 * The position is fetched once from the server and then kept current by the
 * `tournament:live_move` feed, which is separate from actually spectating a
 * game (no spectator count, no spectator chat). A refetch on any tournament
 * update, plus a slow safety poll, swaps in the next game when one finishes.
 */
export function LiveGames({ code }: { code: string }) {
  const socket = useSocket();
  const isDesktop = useIsDesktop(1280);
  const limit: 1 | 2 = isDesktop ? 2 : 1;
  const [games, setGames] = useState<TournamentLiveGame[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const inFlight = useRef(false);
  const queued = useRef(false);
  const load = useCallback(() => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    getTournamentLiveGames(code, limit)
      .then((res) => setGames(res.games))
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
        if (queued.current) {
          queued.current = false;
          load();
        }
      });
  }, [code, limit]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 20_000);
    return () => window.clearInterval(poll);
  }, [load]);

  // Clocks tick on the client between moves.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);

  const gameIdsKey = (games ?? []).map((g) => g.gameId).join(",");
  useEffect(() => {
    if (!socket) return;
    const subscribe = () =>
      socket.emit("tournament:live_subscribe", {
        gameIds: gameIdsKey ? gameIdsKey.split(",") : [],
      });
    subscribe();
    socket.on("connect", subscribe);
    return () => {
      socket.off("connect", subscribe);
    };
  }, [socket, gameIdsKey]);

  useEffect(() => {
    if (!socket) return;
    // Both the move feed and the "something changed" nudges (a game ended, a
    // new pairing started) just arrive here.
    let refetchTimer: number | undefined;
    const refetchSoon = () => {
      window.clearTimeout(refetchTimer);
      refetchTimer = window.setTimeout(load, 700);
    };
    const onMove = (m: {
      gameId: string;
      from: string;
      to: string;
      fen: string;
      whiteRemainingMs: number | null;
      blackRemainingMs: number | null;
      turnStartedAtMs: number;
    }) => {
      setGames((prev) =>
        prev
          ? prev.map((g) =>
              g.gameId === m.gameId
                ? {
                    ...g,
                    fen: m.fen,
                    lastMove: [m.from, m.to],
                    whiteRemainingMs: m.whiteRemainingMs,
                    blackRemainingMs: m.blackRemainingMs,
                    turnStartedAtMs: m.turnStartedAtMs,
                    turn: g.turn === "white" ? "black" : "white",
                    paused: false,
                  }
                : g,
            )
          : prev,
      );
    };
    socket.on("tournament:live_move", onMove);
    socket.on("tournament:live_over", refetchSoon);
    socket.on("tournament:update", refetchSoon);
    socket.on("tournament:started", refetchSoon);
    return () => {
      window.clearTimeout(refetchTimer);
      socket.off("tournament:live_move", onMove);
      socket.off("tournament:live_over", refetchSoon);
      socket.off("tournament:update", refetchSoon);
      socket.off("tournament:started", refetchSoon);
    };
  }, [socket, load]);

  const shown = (games ?? []).slice(0, limit);

  return (
    <Card variant="solid" className="max-md:p-3!">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-base-content/60">
        <Radio className="h-3.5 w-3.5 text-(--secondary)" />
        Live {limit === 1 ? "game" : "games"}
      </div>
      {shown.length > 0 ? (
        <div className="mx-auto grid max-w-sm gap-4">
          {shown.map((g) => (
            <LiveBoard key={g.gameId} game={g} now={now} />
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-base-content/50">
          {games === null ? "Loading…" : "No games being played right now."}
        </p>
      )}
    </Card>
  );
}

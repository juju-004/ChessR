import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import { listMyActiveGames, type MyActiveGame } from "../api/games.js";
import {
  listMyCageMatches,
  computeCageStandings,
  type CageMatch,
} from "../api/cageMatches.js";
import { formatTimeControl } from "../timeControls.js";
import { turnColor } from "../chessUtils.js";
import { useAuth } from "../contexts/AuthContext.js";
import { motion } from "framer-motion";
import { pressable } from "@/lib/motion.js";
import { cn } from "@/lib/cn.js";
import { Popover } from "./ui/Popover.js";
import { Gamepad2 } from "lucide-react";
import { RCoin } from "./ui/RCoin.js";

interface MyGamesMenuProps {
  className?: string;
}

// Deliberately dormant: no background fetching, no socket subscriptions, no
// badge count. It only talks to the server the moment someone opens it,
// keeps this a zero-cost navbar item for everyone who never clicks it, and
// avoids re-rendering it on every move played anywhere in the app.
export function MyGamesMenu({ className }: MyGamesMenuProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<MyActiveGame[] | null>(null);
  const [cageMatches, setCageMatches] = useState<CageMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    Promise.all([listMyActiveGames(), listMyCageMatches()])
      .then(([gamesRes, cageRes]) => {
        setGames(gamesRes.games);
        setCageMatches(cageRes.matches.filter((m) => m.status === "active"));
      })
      .catch(() => setError("Could not load your games"))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      // Fixed w-72 would run off the right edge of narrow phone screens
      // when this sits near the left of the navbar (the original bug),
      // clamping to the viewport width keeps it fully on-screen no matter
      // where the trigger lands.
      className={cn(
        "w-64 sm:w72 max-w-[calc(100vw-2rem)] overflow-hidden",
        className,
      )}
      trigger={
        <motion.button
          aria-label="Your active games"
          aria-expanded={open}
          className="elevated flex h-9 w-9 items-center justify-center rounded-full text-base-content/80 hover:text-base-content"
          {...pressable}
        >
          <Gamepad2 className="h-4 w-4" />
        </motion.button>
      }
    >
      <div className="-m-1.5">
        <div className="border-b border-base-300 px-3 py-2 text-sm font-semibold text-base-content">
          Your games
        </div>

        {error && <p className="p-3 text-sm text-red-400">{error}</p>}

        {!error && loading && games === null && (
          <p className="p-3 text-sm text-base-content/60">Loading…</p>
        )}

        {!error &&
          games &&
          cageMatches &&
          games.filter((g) => !g.cageMatchId).length === 0 &&
          cageMatches.length === 0 && (
            <p className="p-3 text-sm text-base-content/60">
              No active games. Head to the dashboard to start one.
            </p>
          )}

        <div className="max-h-96 overflow-y-auto">
          {cageMatches && cageMatches.length > 0 && (
            <div className="border-b border-base-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-400">
              Cage matches
            </div>
          )}
          {cageMatches?.map((m) => {
            const iAmP1 = m.player1._id === user?.id;
            const opponent = iAmP1 ? m.player2 : m.player1;
            const standings = computeCageStandings(m);
            const myScore = iAmP1 ? standings.p1Score : standings.p2Score;
            const oppScore = iAmP1 ? standings.p2Score : standings.p1Score;
            const activeLeg = m.legs.find((l) => l.status === "active");
            const pausedLeg = m.legs.find((l) => l.status === "paused");

            return (
              <button
                key={m._id}
                onClick={() => {
                  setOpen(false);
                  const leg = activeLeg ?? pausedLeg;
                  navigate(
                    leg?.joinCode
                      ? `/game/${leg.joinCode}`
                      : `/cage/${m.matchCode}`,
                  );
                }}
                className="flex w-full items-center justify-between gap-2 border-b border-base-300 bg-purple-500/5 px-3 py-2 text-left last:border-none hover:bg-purple-500/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-base-content">
                    🥊 vs {opponent.username} · {myScore}–{oppScore}
                  </p>
                  <p className="truncate text-xs text-base-content/50">
                    Game {m.currentLegIndex + 1}/{m.legs.length}
                  </p>
                </div>
                {activeLeg && (
                  <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-500">
                    In progress
                  </span>
                )}
                {!activeLeg && pausedLeg && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
                    Paused
                  </span>
                )}
              </button>
            );
          })}

          {cageMatches &&
            cageMatches.length > 0 &&
            games &&
            games.filter((g) => !g.cageMatchId).length > 0 && (
              <div className="border-b border-base-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                Single games
              </div>
            )}

          {games
            ?.filter((g) => !g.cageMatchId)
            .map((g) => {
              const myColor = g.white._id === user?.id ? "white" : "black";
              const opponent = myColor === "white" ? g.black : g.white;
              const waiting = g.status === "waiting";
              const isMyTurn =
                !waiting && turnColor(new Chess(g.fen)) === myColor;

              return (
                <button
                  key={g._id}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/game/${g.joinCode}`);
                  }}
                  className="flex w-full items-center justify-between gap-2 border-b border-base-300 px-3 py-2 text-left last:border-none hover:bg-base-200"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-base-content">
                      {waiting
                        ? "Waiting for opponent…"
                        : `vs ${opponent?.username ?? "?"}`}
                    </p>
                    <p className="truncate inline-flex gap-0.5 text-xs text-base-content/50">
                      {formatTimeControl(g.timeControl)}
                      {g.variant === "chess960" ? " · Chess960" : ""}
                      {g.wagerTokens > 0 ? (
                        <>
                          {` · ${g.wagerTokens}`}{" "}
                          <RCoin size={10} className="translate-y-0.5"></RCoin>
                        </>
                      ) : (
                        ""
                      )}
                    </p>
                  </div>
                  {isMyTurn && (
                    <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-500">
                      Your move
                    </span>
                  )}
                  {waiting && (
                    <span className="shrink-0 rounded bg-base-300 px-1.5 py-0.5 text-[10px] font-bold text-base-content/80">
                      Waiting
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      </div>
    </Popover>
  );
}

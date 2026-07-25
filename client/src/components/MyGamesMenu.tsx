import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { listMyActiveGames, type MyActiveGame } from '../api/games.js';
import { listMyCageMatches, computeCageStandings, type CageMatch } from '../api/cageMatches.js';
import { formatTimeControl } from '../timeControls.js';
import { turnColor } from '../chessUtils.js';
import { useAuth } from '../contexts/AuthContext.js';

/** Games icon — a simple pawn glyph keeps this visually distinct from the
 *  wallet balance pill and the profile/friends text links either side of it. */
function PawnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-1.8 5.4c-1.6.9-2.7 2.6-2.7 4.6 0 1.3.5 2.5 1.3 3.4C7.5 16.3 6.5 18 6.5 20v.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V20c0-2-1-3.7-2.3-4.6.8-.9 1.3-2.1 1.3-3.4 0-2-1.1-3.7-2.7-4.6A3 3 0 0 0 12 2Z" />
    </svg>
  );
}

interface MyGamesMenuProps {
  className?: string;
}

// Deliberately dormant: no background fetching, no socket subscriptions, no
// badge count. It only talks to the server the moment someone opens it —
// keeps this a zero-cost navbar item for everyone who never clicks it, and
// avoids re-rendering it on every move played anywhere in the app.
export function MyGamesMenu({ className }: MyGamesMenuProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<MyActiveGame[] | null>(null);
  const [cageMatches, setCageMatches] = useState<CageMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    Promise.all([listMyActiveGames(), listMyCageMatches()])
      .then(([gamesRes, cageRes]) => {
        setGames(gamesRes.games);
        setCageMatches(cageRes.matches.filter((m) => m.status === 'active'));
      })
      .catch(() => setError('Could not load your games'))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Your active games"
        aria-expanded={open}
        className="rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <PawnIcon className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          <div className="border-b border-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-200">
            Your games
          </div>

          {error && <p className="p-3 text-sm text-red-400">{error}</p>}

          {!error && loading && games === null && <p className="p-3 text-sm text-neutral-400">Loading…</p>}

          {!error &&
            games &&
            cageMatches &&
            games.filter((g) => !g.cageMatchId).length === 0 &&
            cageMatches.length === 0 && (
              <p className="p-3 text-sm text-neutral-400">No active games. Head to the dashboard to start one.</p>
            )}

          <div className="max-h-96 overflow-y-auto">
            {cageMatches && cageMatches.length > 0 && (
              <div className="border-b border-neutral-800 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-400">
                Cage matches
              </div>
            )}
            {cageMatches?.map((m) => {
              const iAmP1 = m.player1._id === user?.id;
              const opponent = iAmP1 ? m.player2 : m.player1;
              const standings = computeCageStandings(m);
              const myScore = iAmP1 ? standings.p1Score : standings.p2Score;
              const oppScore = iAmP1 ? standings.p2Score : standings.p1Score;
              const activeLeg = m.legs.find((l) => l.status === 'active');
              const pausedLeg = m.legs.find((l) => l.status === 'paused');

              return (
                <button
                  key={m._id}
                  onClick={() => {
                    setOpen(false);
                    const leg = activeLeg ?? pausedLeg;
                    navigate(leg?.joinCode ? `/game/${leg.joinCode}` : `/cage/${m.matchCode}`);
                  }}
                  className="flex w-full items-center justify-between gap-2 border-b border-neutral-800 bg-purple-950/10 px-3 py-2 text-left last:border-none hover:bg-purple-950/20"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-neutral-100">
                      🥊 vs {opponent.username} · {myScore}–{oppScore}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      Leg {m.currentLegIndex + 1}/{m.legs.length}
                    </p>
                  </div>
                  {activeLeg && (
                    <span className="shrink-0 rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">
                      In progress
                    </span>
                  )}
                  {!activeLeg && pausedLeg && (
                    <span className="shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                      Paused
                    </span>
                  )}
                </button>
              );
            })}

            {cageMatches && cageMatches.length > 0 && games && games.filter((g) => !g.cageMatchId).length > 0 && (
              <div className="border-b border-neutral-800 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Single games
              </div>
            )}

            {games
              ?.filter((g) => !g.cageMatchId)
              .map((g) => {
                const myColor = g.white._id === user?.id ? 'white' : 'black';
                const opponent = myColor === 'white' ? g.black : g.white;
                const waiting = g.status === 'waiting';
                const isMyTurn = !waiting && turnColor(new Chess(g.fen)) === myColor;

                return (
                  <button
                    key={g._id}
                    onClick={() => {
                      setOpen(false);
                      navigate(`/game/${g.joinCode}`);
                    }}
                    className="flex w-full items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2 text-left last:border-none hover:bg-neutral-800"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-neutral-100">
                        {waiting ? 'Waiting for opponent…' : `vs ${opponent?.username ?? '?'}`}
                      </p>
                      <p className="truncate text-xs text-neutral-500">
                        {formatTimeControl(g.timeControl)}
                        {g.variant === 'chess960' ? ' · Chess960' : ''}
                        {g.wagerTokens > 0 ? ` · ${g.wagerTokens} R wager` : ''}
                      </p>
                    </div>
                    {isMyTurn && (
                      <span className="shrink-0 rounded bg-red-900/40 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                        Your move
                      </span>
                    )}
                    {waiting && (
                      <span className="shrink-0 rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] font-bold text-neutral-300">
                        Waiting
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

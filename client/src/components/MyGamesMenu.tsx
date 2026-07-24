import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { listMyActiveGames, type MyActiveGame } from '../api/games.js';
import { formatTimeControl } from '../timeControls.js';
import { turnColor } from '../chessUtils.js';
import { useAuth } from '../contexts/AuthContext.js';
import { useSocket } from '../contexts/SocketContext.js';

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

export function MyGamesMenu({ className }: MyGamesMenuProps) {
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<MyActiveGame[] | null>(null);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    listMyActiveGames()
      .then((res) => setGames(res.games))
      .catch(() => setError('Could not load your games'));
  }, []);

  // Initial load, then keep it fresh from the server in real time — a move,
  // a new game starting, or one ending all ping this via socket regardless
  // of which page you're on, so the badge count never goes stale just
  // because the dropdown itself is closed.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    const onChanged = () => refresh();
    socket.on('myGames:changed', onChanged);
    socket.on('challenge:accepted', onChanged);
    socket.on('game:rematch_accepted', onChanged);
    return () => {
      socket.off('myGames:changed', onChanged);
      socket.off('challenge:accepted', onChanged);
      socket.off('game:rematch_accepted', onChanged);
    };
  }, [socket, refresh]);

  // Refetch every time the menu is opened too, so it can't ever show a
  // stuck/stale list if a socket event was somehow missed.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const myTurnCount =
    games?.filter((g) => {
      if (g.status !== 'active' || !g.black) return false;
      const myColor = g.white._id === user?.id ? 'white' : 'black';
      return turnColor(new Chess(g.fen)) === myColor;
    }).length ?? 0;

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Your active games"
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <PawnIcon className="h-5 w-5" />
        {myTurnCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {myTurnCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
          <div className="border-b border-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-200">
            Your games
          </div>

          {error && <p className="p-3 text-sm text-red-400">{error}</p>}

          {!error && games === null && <p className="p-3 text-sm text-neutral-400">Loading…</p>}

          {games && games.length === 0 && (
            <p className="p-3 text-sm text-neutral-400">No active games. Head to the dashboard to start one.</p>
          )}

          <div className="max-h-96 overflow-y-auto">
            {games?.map((g) => {
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

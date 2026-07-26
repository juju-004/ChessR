import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getGameByCode } from '../api/games.js';
import { ApiRequestError } from '../api/http.js';
import { ChessBoard } from '../components/ChessBoard.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { formatTimeControl } from '../timeControls.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface ReplayMove {
  san: string;
  from: string;
  to: string;
  fenAfter: string;
  moveNumber: number;
}

interface ReplayGame {
  joinCode: string;
  white: { username: string };
  black: { username: string };
  result: string | null;
  endReason: string | null;
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  moves: ReplayMove[];
}

export function GameReplay() {
  const { code = '' } = useParams<{ code: string }>();
  const { settings } = useSettings();
  const [game, setGame] = useState<ReplayGame | null>(null);
  const [error, setError] = useState('');
  // -1 means the starting position, before any move has been played.
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    getGameByCode(code)
      .then(({ game }) => {
        setGame(game);
        setIndex(game.moves.length > 0 ? game.moves.length - 1 : -1);
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Game not found'));
  }, [code]);

  if (error) {
    return <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-red-900 bg-red-950/40 p-5 text-red-400">{error}</div>;
  }
  if (!game) {
    return <div className="mx-auto mt-6 max-w-2xl text-neutral-400">Loading…</div>;
  }

  const current = index >= 0 ? game.moves[index] : null;
  const fen = current?.fenAfter ?? STARTING_FEN;
  const lastMove: [string, string] | undefined = current ? [current.from, current.to] : undefined;

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-1 text-xl font-bold text-neutral-100">
          {game.white.username} vs {game.black.username}
        </h1>
        <p className="mb-3 text-sm text-neutral-400">
          {formatTimeControl(game.timeControl)} ·{' '}
          {game.result === 'draw' ? 'Draw' : game.result === 'white' ? `${game.white.username} won` : `${game.black.username} won`}
          {game.endReason ? ` (${game.endReason.replace(/_/g, ' ')})` : ''}
        </p>

        <div
          className={`relative mx-auto aspect-square w-full max-w-[480px] board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme}`}
        >
          <ChessBoard
            fen={fen}
            orientation="white"
            viewOnly
            turnColor="white"
            dests={new Map()}
            lastMove={lastMove}
            onUserMove={() => {}}
            animationEnabled={settings.pieceAnimation}
            showCoordinates={settings.showCoordinates}
          />
        </div>

        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            onClick={() => setIndex(-1)}
            disabled={index === -1}
            className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 disabled:opacity-30"
          >
            ⏮ Start
          </button>
          <button
            onClick={() => setIndex((i) => Math.max(-1, i - 1))}
            disabled={index === -1}
            className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 disabled:opacity-30"
          >
            ◀ Prev
          </button>
          <span className="text-sm text-neutral-400">
            {index + 1} / {game.moves.length}
          </span>
          <button
            onClick={() => setIndex((i) => Math.min(game.moves.length - 1, i + 1))}
            disabled={index >= game.moves.length - 1}
            className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 disabled:opacity-30"
          >
            Next ▶
          </button>
          <button
            onClick={() => setIndex(game.moves.length - 1)}
            disabled={index >= game.moves.length - 1}
            className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 disabled:opacity-30"
          >
            End ⏭
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">Moves</h2>
        <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto font-mono text-sm">
          {game.moves.map((m, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`rounded px-2 py-1 text-left ${i === index ? 'bg-blue-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'}`}
            >
              {m.moveNumber}. {m.san}
            </button>
          ))}
        </div>
      </div>

      <Link to={`/game/${game.joinCode}`} className="inline-block text-sm text-blue-400 hover:underline">
        Go to live game page →
      </Link>
    </div>
  );
}

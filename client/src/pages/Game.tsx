import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { getGameByCode, joinGame } from '../api/games.js';
import { ApiRequestError } from '../api/http.js';
import { useAuth } from '../contexts/AuthContext.js';
import { useSocket } from '../contexts/SocketContext.js';
import { useNotify } from '../contexts/NotificationContext.js';
import { ChessBoard } from '../components/ChessBoard.js';
import { PromotionPicker } from '../components/PromotionPicker.js';
import { ClockDisplay } from '../components/ClockDisplay.js';
import { computeDests, needsPromotion, computePremoveDests, findCheckSquare } from '../chessUtils.js';

interface GameMeta {
  _id: string;
  joinCode: string;
  white: { _id: string; username: string } | null;
  black: { _id: string; username: string } | null;
  status: 'waiting' | 'active' | 'finished';
}

interface MoveLogEntry {
  moveNumber: number;
  san: string;
  from: string;
  to: string;
}

type Role = 'white' | 'black' | 'spectator';

export function Game() {
  const { code = '' } = useParams<{ code: string }>();
  const { user } = useAuth();
  const socket = useSocket();
  const { notify } = useNotify();

  const [gameMeta, setGameMeta] = useState<GameMeta | null>(null);
  const [mode, setMode] = useState<'loading' | 'need-join' | 'board'>('loading');
  const [loadError, setLoadError] = useState('');

  const [role, setRole] = useState<Role>('spectator');
  const [status, setStatus] = useState<'waiting' | 'active' | 'finished'>('active');
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [moves, setMoves] = useState<MoveLogEntry[]>([]);
  const [whiteRemainingMs, setWhiteRemainingMs] = useState<number | null>(null);
  const [blackRemainingMs, setBlackRemainingMs] = useState<number | null>(null);
  const [turnStartedAtMs, setTurnStartedAtMs] = useState(Date.now());
  const [gameOver, setGameOver] = useState<{ result: string | null; reason: string } | null>(null);
  const [connStatus, setConnStatus] = useState('Connecting…');
  const [moveError, setMoveError] = useState('');
  const [promoPending, setPromoPending] = useState<{ orig: string; dest: string } | null>(null);
  const [disconnectBanner, setDisconnectBanner] = useState<{ message: string; claimable: boolean } | null>(null);
  const [rematchState, setRematchState] = useState<'idle' | 'offered'>('idle');

  const chess = useMemo(() => new Chess(fen), [fen]);

  // --- Load game metadata, decide whether to show a "join" gate --------------
  useEffect(() => {
    let cancelled = false;
    setMode('loading');
    setLoadError('');

    getGameByCode(code)
      .then(({ game }) => {
        if (cancelled) return;
        setGameMeta(game);
        const isWhite = game.white?._id === user?.id;
        if (game.status === 'waiting' && !isWhite) {
          setMode('need-join');
        } else {
          setMode('board');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiRequestError ? err.message : 'Game not found');
        setMode('loading');
      });

    return () => {
      cancelled = true;
    };
  }, [code, user?.id]);

  async function handleJoin() {
    if (!gameMeta) return;
    try {
      await joinGame(gameMeta._id);
      setMode('board');
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not join');
    }
  }

  // --- Socket wiring once we're ready to actually show a board ---------------
  useEffect(() => {
    if (mode !== 'board' || !socket || !gameMeta) return;
    const gameId = gameMeta._id;
    setConnStatus('Connecting…');

    function deriveLastMove(moveList: MoveLogEntry[]): [string, string] | undefined {
      const last = moveList[moveList.length - 1];
      return last ? [last.from, last.to] : undefined;
    }

    function onConnectError(err: Error) {
      setConnStatus((prev) => (prev === 'Connecting…' ? `Connection failed: ${err.message}` : prev));
    }

    // Room membership does not survive a reconnect — a dropped/restarted
    // connection gets a brand-new server-side socket that isn't in the game
    // room until we explicitly rejoin. Listening on 'connect' (which fires on
    // the *first* connection too) means this is the single source of truth
    // for joining, covering both the initial mount and any later reconnect.
    function joinRoom() {
      socket.emit('game:join', { gameId });
    }

    function onSync(payload: any) {
      setRole(payload.role);
      setStatus(payload.status);
      setFen(payload.fen);
      setMoves(payload.moves ?? []);
      setLastMove(deriveLastMove(payload.moves ?? []));
      setWhiteRemainingMs(payload.whiteRemainingMs);
      setBlackRemainingMs(payload.blackRemainingMs);
      setTurnStartedAtMs(payload.turnStartedAtMs);
      setGameOver(payload.status === 'finished' && payload.result ? { result: payload.result, reason: payload.endReason } : null);
      setConnStatus(payload.role === 'spectator' ? 'Spectating' : payload.status === 'active' ? 'Your game' : payload.status);
    }

    function onMove(payload: any) {
      setFen(payload.fen);
      setLastMove([payload.from, payload.to]);
      setWhiteRemainingMs(payload.whiteRemainingMs);
      setBlackRemainingMs(payload.blackRemainingMs);
      setTurnStartedAtMs(payload.turnStartedAtMs);
      setMoves((prev) => [...prev, { moveNumber: payload.moveNumber, san: payload.san, from: payload.from, to: payload.to }]);
    }

    function onOver(payload: { result: string | null; reason: string }) {
      setStatus('finished');
      setGameOver(payload);
      setDisconnectBanner(null);
    }

    function onError(payload: { message: string }) {
      setMoveError(payload.message);
    }

    function onOpponentConnected() {
      setConnStatus((s) => (s === 'Your game' || s === 'active' ? 'Opponent connected' : s));
    }

    function onStateChanged() {
      socket.emit('game:join', { gameId });
    }

    function onOpponentDisconnected(payload: { graceMs: number }) {
      const expiresAt = Date.now() + payload.graceMs;
      let intervalId: number | undefined;
      const tick = () => {
        const remaining = Math.max(0, expiresAt - Date.now());
        setDisconnectBanner({
          message:
            remaining > 0
              ? `Opponent disconnected. You can claim the game in ${Math.ceil(remaining / 1000)}s if they don't return.`
              : 'Opponent has not reconnected — you can claim this game now.',
          claimable: remaining <= 0,
        });
        if (remaining <= 0 && intervalId !== undefined) window.clearInterval(intervalId);
      };
      tick();
      intervalId = window.setInterval(tick, 500);
    }

    function onClaimAvailable() {
      setDisconnectBanner({ message: 'Opponent has not reconnected — you can claim this game now.', claimable: true });
    }

    function onOpponentReconnected() {
      setDisconnectBanner(null);
    }

    function onDrawOffered() {
      notify('Your opponent offered a draw.', [
        { label: 'Accept', onClick: () => socket.emit('game:respond_draw', { gameId, accept: true }) },
        { label: 'Decline', variant: 'secondary', onClick: () => socket.emit('game:respond_draw', { gameId, accept: false }) },
      ]);
    }

    socket.on('connect_error', onConnectError);
    socket.on('connect', joinRoom);
    socket.on('game:sync', onSync);
    socket.on('game:move', onMove);
    socket.on('game:over', onOver);
    socket.on('game:error', onError);
    socket.on('game:opponent_connected', onOpponentConnected);
    socket.on('game:state_changed', onStateChanged);
    socket.on('game:opponent_disconnected', onOpponentDisconnected);
    socket.on('game:claim_available', onClaimAvailable);
    socket.on('game:opponent_reconnected', onOpponentReconnected);
    socket.on('game:draw_offered', onDrawOffered);

    // Covers the common case where the socket is already connected by the
    // time this effect runs (normal navigation to the page).
    if (socket.connected) joinRoom();

    return () => {
      socket.off('connect_error', onConnectError);
      socket.off('connect', joinRoom);
      socket.off('game:sync', onSync);
      socket.off('game:move', onMove);
      socket.off('game:over', onOver);
      socket.off('game:error', onError);
      socket.off('game:opponent_connected', onOpponentConnected);
      socket.off('game:state_changed', onStateChanged);
      socket.off('game:opponent_disconnected', onOpponentDisconnected);
      socket.off('game:claim_available', onClaimAvailable);
      socket.off('game:opponent_reconnected', onOpponentReconnected);
      socket.off('game:draw_offered', onDrawOffered);
    };
  }, [mode, socket, gameMeta, notify]);

  const handleUserMove = useCallback(
    (orig: string, dest: string) => {
      if (!socket || !gameMeta) return;
      setMoveError('');
      const localChess = new Chess(fen);
      if (needsPromotion(localChess, orig, dest)) {
        setPromoPending({ orig, dest });
        return;
      }
      socket.emit('game:move', { gameId: gameMeta._id, from: orig, to: dest });
    },
    [socket, gameMeta, fen],
  );

  function handlePromotionPick(piece: 'q' | 'r' | 'b' | 'n') {
    if (!promoPending || !socket || !gameMeta) return;
    socket.emit('game:move', { gameId: gameMeta._id, from: promoPending.orig, to: promoPending.dest, promotion: piece });
    setPromoPending(null);
  }

  function handleResign() {
    if (!socket || !gameMeta) return;
    if (confirm('Are you sure you want to resign?')) {
      socket.emit('game:resign', { gameId: gameMeta._id });
    }
  }

  function handleAbort() {
    if (!socket || !gameMeta) return;
    if (confirm('Abort this game? No result will be recorded for either player.')) {
      socket.emit('game:abort', { gameId: gameMeta._id });
    }
  }

  function handleOfferDraw() {
    if (!socket || !gameMeta) return;
    socket.emit('game:offer_draw', { gameId: gameMeta._id });
  }

  function handleClaim(claim: 'win' | 'draw') {
    if (!socket || !gameMeta) return;
    socket.emit('game:claim_disconnect', { gameId: gameMeta._id, claim });
  }

  function handleRematch() {
    if (!socket || !gameMeta) return;
    socket.emit('game:rematch_offer', { gameId: gameMeta._id });
    setRematchState('offered');
    notify('Rematch offer sent — waiting for your opponent…', [], 5000);
  }

  if (loadError) {
    return <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-red-900 bg-red-950/40 p-5 text-red-400">{loadError}</div>;
  }

  if (mode === 'loading') {
    return <div className="mx-auto mt-6 max-w-2xl text-neutral-400">Loading…</div>;
  }

  if (mode === 'need-join' && gameMeta) {
    return (
      <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-2 text-xl font-bold text-neutral-100">
          Game <span className="font-normal text-neutral-500">· {code}</span>
        </h1>
        <p className="mb-3 text-sm text-neutral-400">{gameMeta.white?.username} is waiting for an opponent.</p>
        <button onClick={handleJoin} className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500">
          Join this game
        </button>
      </div>
    );
  }

  const isPlayer = role !== 'spectator';
  const myColor: 'white' | 'black' | undefined = role === 'white' || role === 'black' ? role : undefined;
  const dests = computeDests(chess);
  const premoveDests = myColor ? computePremoveDests(chess, myColor) : new Map<string, string[]>();
  const checkSquare = findCheckSquare(chess);

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-bold text-neutral-100">
            Game <span className="font-normal text-neutral-500">· {code}</span>
          </h1>
          <span className="text-sm text-neutral-400">
            {gameOver ? `Game over — ${describeResult(gameOver.result)} (${gameOver.reason.replace(/_/g, ' ')})` : connStatus}
          </span>
        </div>

        {disconnectBanner && (
          <div className="mb-3 rounded-md border border-red-900 bg-red-950/40 p-3">
            <p className="mb-2 text-sm text-red-300">{disconnectBanner.message}</p>
            {disconnectBanner.claimable && (
              <div className="flex gap-2">
                <button onClick={() => handleClaim('win')} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500">
                  Claim victory
                </button>
                <button onClick={() => handleClaim('draw')} className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-600">
                  Claim draw
                </button>
              </div>
            )}
          </div>
        )}

        <ClockDisplay
          fen={fen}
          whiteRemainingMs={whiteRemainingMs}
          blackRemainingMs={blackRemainingMs}
          turnStartedAtMs={turnStartedAtMs}
          isActive={status === 'active'}
          whiteUsername={gameMeta?.white?.username}
          blackUsername={gameMeta?.black?.username}
        />

        <div className="relative mx-auto aspect-square w-full max-w-[480px]">
          <ChessBoard
            fen={fen}
            orientation={myColor ?? 'white'}
            viewOnly={!isPlayer || status !== 'active'}
            turnColor={chess.turn() === 'w' ? 'white' : 'black'}
            movableColor={myColor}
            dests={dests}
            premoveDests={premoveDests}
            checkSquare={checkSquare}
            lastMove={lastMove}
            onUserMove={handleUserMove}
          />
          {promoPending && <PromotionPicker onPick={handlePromotionPick} />}
        </div>

        {moveError && <p className="mt-2 text-sm text-red-400">{moveError}</p>}

        {isPlayer && status === 'active' && (
          <div className="mt-3 flex gap-2">
            {moves.length === 0 && (
              <button onClick={handleAbort} className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-600">
                Abort game
              </button>
            )}
            <button onClick={handleOfferDraw} className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-600">
              Offer draw
            </button>
            <button onClick={handleResign} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">
              Resign
            </button>
          </div>
        )}

        {isPlayer && status === 'finished' && gameOver?.reason !== 'aborted_no_moves' && (
          <div className="mt-3">
            <button
              onClick={handleRematch}
              disabled={rematchState === 'offered'}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {rematchState === 'offered' ? 'Rematch offer sent…' : 'Rematch'}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">Moves</h2>
        <div className="max-h-48 overflow-y-auto font-mono text-sm text-neutral-300">
          {moves.map((m) => (
            <div key={m.moveNumber}>
              {m.moveNumber}. {m.san}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function describeResult(result: string | null): string {
  if (result === 'white') return 'White wins';
  if (result === 'black') return 'Black wins';
  if (result === 'draw') return 'Draw';
  return 'Game aborted';
}

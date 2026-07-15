import { Chessground } from '@lichess-org/chessground';
import { Chess } from 'chess.js';
import { connectSocket } from '../socket.js';
import { authState } from '../state.js';
import { getGameByCode, joinGame } from '../api/games.js';
import { ApiRequestError } from '../api/http.js';
import { computeDests, needsPromotion, turnColor } from '../chessUtils.js';

// Derive chessground's Config type from its own constructor rather than guessing
// a deep import path for the type — keeps this resilient to minor version bumps.
type CgApi = ReturnType<typeof Chessground>;
type CgConfig = NonNullable<Parameters<typeof Chessground>[1]>;

interface GameCtx {
  gameId: string;
  joinCode: string;
  role: 'white' | 'black' | 'spectator';
  ground: CgApi | null;
  chess: Chess;
  clockInterval: number | null;
  whiteRemainingMs: number | null;
  blackRemainingMs: number | null;
  turnStartedAtMs: number;
  status: 'waiting' | 'active' | 'finished';
}

let ctx: GameCtx | null = null;

export async function renderGame(params: { code: string }) {
  const code = params.code.toUpperCase();
  const app = document.getElementById('app')!;

  app.innerHTML = `
    <div class="card">
      <div class="row" style="border: none;">
        <h1 style="margin:0;">Game <span class="muted" style="font-weight:400;">· ${code}</span></h1>
        <span id="game-status" class="muted"></span>
      </div>
      <p class="muted" id="join-prompt" style="display:none;"></p>
      <button id="join-as-opponent-btn" style="display:none;">Join this game</button>
      <div id="clocks" style="display:flex; gap: 1rem; margin: 0.75rem 0;">
        <div class="fen-box" id="clock-black" style="flex:1; text-align:center;">--:--</div>
        <div class="fen-box" id="clock-white" style="flex:1; text-align:center;">--:--</div>
      </div>
      <div id="board-wrapper" style="position:relative; width: min(480px, 100%); aspect-ratio: 1 / 1; margin: 0 auto;">
        <div id="board" class="cg-wrap"></div>
        <div id="promo-picker" style="display:none;"></div>
      </div>
      <div class="error" id="move-error"></div>
      <div id="controls" style="margin-top: 0.75rem; display:none;">
        <button class="secondary" id="offer-draw-btn">Offer draw</button>
        <button class="danger" id="resign-btn">Resign</button>
      </div>
    </div>
    <div class="card">
      <h2>Moves</h2>
      <div class="move-log" id="move-log"></div>
    </div>
  `;

  const statusEl = document.getElementById('game-status')!;
  const moveErrorEl = document.getElementById('move-error')!;

  let game;
  try {
    const res = await getGameByCode(code);
    game = res.game;
  } catch (err) {
    app.innerHTML = `<div class="card error">${err instanceof ApiRequestError ? err.message : 'Game not found'}</div>`;
    return;
  }

  const myId = authState.user?.id;
  const isWhite = game.white?._id === myId;

  // While status is 'waiting', black hasn't joined yet — so anyone who isn't the
  // creator is, by definition, a prospective opponent, not a reconnecting player.
  if (game.status === 'waiting' && !isWhite) {
    const promptEl = document.getElementById('join-prompt')!;
    const joinBtn = document.getElementById('join-as-opponent-btn')!;
    promptEl.style.display = 'block';
    promptEl.textContent = `${game.white.username} is waiting for an opponent.`;
    joinBtn.style.display = 'inline-block';
    joinBtn.addEventListener('click', async () => {
      try {
        await joinGame(game._id);
        renderGame({ code }); // re-mount now that the game is active
      } catch (err) {
        moveErrorEl.textContent = err instanceof ApiRequestError ? err.message : 'Could not join';
      }
    });
    statusEl.textContent = 'Waiting for opponent';
    return; // don't build a board yet — nothing to play
  }

  mountBoard(game._id, code);
}

function mountBoard(gameId: string, joinCode: string) {
  const statusEl = document.getElementById('game-status')!;
  const moveErrorEl = document.getElementById('move-error')!;
  const moveLogEl = document.getElementById('move-log')!;
  const controlsEl = document.getElementById('controls')!;
  const boardEl = document.getElementById('board')!;
  const promoEl = document.getElementById('promo-picker')!;

  ctx = {
    gameId,
    joinCode,
    role: 'spectator',
    ground: null,
    chess: new Chess(),
    clockInterval: null,
    whiteRemainingMs: null,
    blackRemainingMs: null,
    turnStartedAtMs: Date.now(),
    status: 'active',
  };

  const socket = connectSocket();

  ['game:sync', 'game:move', 'game:over', 'game:error', 'game:opponent_connected', 'game:draw_offered']
    .forEach((evt) => socket.off(evt));

  socket.emit('game:join', { gameId });

  socket.on('game:sync', (payload: any) => {
    if (!ctx) return;
    ctx.role = payload.role;
    ctx.status = payload.status;
    ctx.chess = new Chess(payload.fen);
    ctx.whiteRemainingMs = payload.whiteRemainingMs;
    ctx.blackRemainingMs = payload.blackRemainingMs;
    ctx.turnStartedAtMs = payload.turnStartedAtMs;

    statusEl.textContent =
      ctx.role === 'spectator' ? 'Spectating' : ctx.status === 'active' ? 'Your game' : ctx.status;

    moveLogEl.innerHTML = (payload.moves ?? [])
      .map((m: any) => `${m.moveNumber}. ${m.san}`)
      .join('<br/>');

    controlsEl.style.display = ctx.role !== 'spectator' && ctx.status === 'active' ? 'block' : 'none';

    initOrUpdateBoard(boardEl, socket);
    startClockTicker();
  });

  socket.on('game:move', (payload: any) => {
    if (!ctx) return;
    ctx.chess = new Chess(payload.fen);
    ctx.whiteRemainingMs = payload.whiteRemainingMs;
    ctx.blackRemainingMs = payload.blackRemainingMs;
    ctx.turnStartedAtMs = payload.turnStartedAtMs;

    moveLogEl.innerHTML += `${moveLogEl.innerHTML ? '<br/>' : ''}${payload.moveNumber}. ${payload.san}`;
    moveLogEl.scrollTop = moveLogEl.scrollHeight;

    updateBoardFromState();
  });

  socket.on('game:over', (payload: { result: string; reason: string }) => {
    if (!ctx) return;
    ctx.status = 'finished';
    statusEl.textContent = `Game over — ${describeResult(payload.result)} (${payload.reason.replace('_', ' ')})`;
    controlsEl.style.display = 'none';
    stopClockTicker();
    ctx.ground?.set({ movable: { color: undefined, dests: new Map() } });
  });

  socket.on('game:error', (payload: { message: string }) => {
    moveErrorEl.textContent = payload.message;
    // Server rejected our optimistic move — snap the board back to the last known-good fen.
    if (ctx) ctx.ground?.set({ fen: ctx.chess.fen() });
  });

  socket.on('game:opponent_connected', () => {
    if (ctx?.status === 'active') statusEl.textContent = 'Opponent connected';
  });

  socket.on('game:draw_offered', () => {
    const accept = confirm('Your opponent offered a draw. Accept?');
    socket.emit('game:respond_draw', { gameId, accept });
  });

  document.getElementById('offer-draw-btn')!.addEventListener('click', () => {
    socket.emit('game:offer_draw', { gameId });
  });

  document.getElementById('resign-btn')!.addEventListener('click', () => {
    if (confirm('Are you sure you want to resign?')) {
      socket.emit('game:resign', { gameId });
    }
  });

  function initOrUpdateBoard(el: HTMLElement, socket: ReturnType<typeof connectSocket>) {
    if (!ctx) return;
    const isPlayer = ctx.role !== 'spectator';
    const myColor = ctx.role === 'white' || ctx.role === 'black' ? ctx.role : undefined;

    const config: CgConfig = {
      fen: ctx.chess.fen(),
      orientation: myColor ?? 'white',
      viewOnly: !isPlayer || ctx.status !== 'active',
      turnColor: turnColor(ctx.chess),
      movable: {
        free: false,
        color: myColor,
        dests: computeDests(ctx.chess) as any,
        events: {
          after: (orig: string, dest: string) => handleUserMove(orig, dest, socket),
        },
      },
    };

    if (!ctx.ground) {
      ctx.ground = Chessground(el, config);
    } else {
      ctx.ground.set(config);
    }
  }

  function updateBoardFromState() {
    if (!ctx?.ground) return;
    ctx.ground.set({
      fen: ctx.chess.fen(),
      turnColor: turnColor(ctx.chess),
      movable: {
        color: ctx.role === 'white' || ctx.role === 'black' ? ctx.role : undefined,
        dests: computeDests(ctx.chess) as any,
      },
    });
  }

  function handleUserMove(orig: string, dest: string, socket: ReturnType<typeof connectSocket>) {
    if (!ctx) return;
    moveErrorEl.textContent = '';

    const promoRequired = needsPromotion(ctx.chess, orig, dest);
    if (promoRequired) {
      showPromotionPicker((piece) => {
        socket.emit('game:move', { gameId: ctx!.gameId, from: orig, to: dest, promotion: piece });
      });
      return;
    }

    socket.emit('game:move', { gameId: ctx.gameId, from: orig, to: dest });
  }

  function showPromotionPicker(onPick: (piece: 'q' | 'r' | 'b' | 'n') => void) {
    const pieces: Array<{ key: 'q' | 'r' | 'b' | 'n'; label: string }> = [
      { key: 'q', label: '♛ Queen' },
      { key: 'r', label: '♜ Rook' },
      { key: 'b', label: '♝ Bishop' },
      { key: 'n', label: '♞ Knight' },
    ];
    promoEl.innerHTML = pieces
      .map((p) => `<button data-piece="${p.key}" style="display:block; width:100%; margin-bottom:4px;">${p.label}</button>`)
      .join('');
    promoEl.style.cssText =
      'display:block; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:10; background:#1f232a; border:1px solid #30353d; border-radius:8px; padding:0.75rem;';

    promoEl.querySelectorAll<HTMLButtonElement>('button[data-piece]').forEach((btn) => {
      btn.addEventListener('click', () => {
        promoEl.style.display = 'none';
        onPick(btn.dataset.piece as 'q' | 'r' | 'b' | 'n');
      });
    });
  }

  function startClockTicker() {
    stopClockTicker();
    if (!ctx) return;
    ctx.clockInterval = window.setInterval(renderClocks, 250);
    renderClocks();
  }

  function stopClockTicker() {
    if (ctx?.clockInterval !== null && ctx?.clockInterval !== undefined) {
      window.clearInterval(ctx.clockInterval);
      if (ctx) ctx.clockInterval = null;
    }
  }

  function renderClocks() {
    if (!ctx) return;
    const whiteEl = document.getElementById('clock-white')!;
    const blackEl = document.getElementById('clock-black')!;

    if (ctx.whiteRemainingMs === null || ctx.blackRemainingMs === null) {
      whiteEl.textContent = 'White · ∞';
      blackEl.textContent = 'Black · ∞';
      return;
    }

    const sideToMove = turnColor(ctx.chess);
    const elapsed = ctx.status === 'active' ? Date.now() - ctx.turnStartedAtMs : 0;

    const liveWhite = sideToMove === 'white' ? ctx.whiteRemainingMs - elapsed : ctx.whiteRemainingMs;
    const liveBlack = sideToMove === 'black' ? ctx.blackRemainingMs - elapsed : ctx.blackRemainingMs;

    whiteEl.textContent = `White · ${formatClock(liveWhite)}`;
    blackEl.textContent = `Black · ${formatClock(liveBlack)}`;
  }
}

function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function describeResult(result: string): string {
  if (result === 'white') return 'White wins';
  if (result === 'black') return 'Black wins';
  return 'Draw';
}

import { connectSocket } from '../socket.js';

interface MoveLogEntry {
  moveNumber: number;
  san: string;
}

export function renderGame(params: { gameId: string }) {
  const { gameId } = params;
  const app = document.getElementById('app')!;

  app.innerHTML = `
    <div class="card">
      <h1>Game</h1>
      <p class="muted" id="game-status">Connecting…</p>
      <div class="fen-box" id="fen-display"></div>
    </div>
    <div class="card">
      <h2>Make a move</h2>
      <p class="muted">Raw input for now — the board renders here once chessground is wired in.</p>
      <form id="move-form">
        <label>From (e.g. e2)</label>
        <input type="text" id="from-input" maxlength="2" required />
        <label>To (e.g. e4)</label>
        <input type="text" id="to-input" maxlength="2" required />
        <label>Promotion (optional: q, r, b, n)</label>
        <input type="text" id="promo-input" maxlength="1" />
        <div class="error" id="move-error"></div>
        <button type="submit">Play move</button>
      </form>
      <div style="margin-top: 0.75rem;">
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
  const fenEl = document.getElementById('fen-display')!;
  const moveLogEl = document.getElementById('move-log')!;
  const moveErrorEl = document.getElementById('move-error')!;

  const moves: MoveLogEntry[] = [];

  function renderMoveLog() {
    moveLogEl.innerHTML = moves.map((m) => `${m.moveNumber}. ${m.san}`).join('<br/>');
    moveLogEl.scrollTop = moveLogEl.scrollHeight;
  }

  const socket = connectSocket();

  // Clean slate: avoid stacking listeners if the user navigates between games.
  ['game:sync', 'game:move', 'game:over', 'game:error', 'game:opponent_connected', 'game:draw_offered']
    .forEach((evt) => socket.off(evt));

  socket.emit('game:join', { gameId });

  socket.on('game:sync', (payload: { fen: string; status: string; moves: any[] }) => {
    statusEl.textContent = `Status: ${payload.status}`;
    fenEl.textContent = payload.fen;
    moves.length = 0;
    (payload.moves ?? []).forEach((m) => moves.push({ moveNumber: m.moveNumber, san: m.san }));
    renderMoveLog();
  });

  socket.on('game:move', (payload: { fen: string; san: string; moveNumber: number }) => {
    fenEl.textContent = payload.fen;
    moves.push({ moveNumber: payload.moveNumber, san: payload.san });
    renderMoveLog();
  });

  socket.on('game:over', (payload: { result: string; reason: string }) => {
    statusEl.textContent = `Game over — ${payload.result} (${payload.reason})`;
  });

  socket.on('game:error', (payload: { message: string }) => {
    moveErrorEl.textContent = payload.message;
  });

  socket.on('game:opponent_connected', () => {
    statusEl.textContent = 'Opponent connected';
  });

  socket.on('game:draw_offered', () => {
    const accept = confirm('Your opponent offered a draw. Accept?');
    socket.emit('game:respond_draw', { gameId, accept });
  });

  document.getElementById('move-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    moveErrorEl.textContent = '';
    const from = (document.getElementById('from-input') as HTMLInputElement).value.trim().toLowerCase();
    const to = (document.getElementById('to-input') as HTMLInputElement).value.trim().toLowerCase();
    const promotion = (document.getElementById('promo-input') as HTMLInputElement).value.trim().toLowerCase();
    socket.emit('game:move', { gameId, from, to, promotion: promotion || undefined });
  });

  document.getElementById('offer-draw-btn')!.addEventListener('click', () => {
    socket.emit('game:offer_draw', { gameId });
  });

  document.getElementById('resign-btn')!.addEventListener('click', () => {
    if (confirm('Are you sure you want to resign?')) {
      socket.emit('game:resign', { gameId });
    }
  });
}

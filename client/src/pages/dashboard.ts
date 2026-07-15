import { createGame, joinGame, listOpenGames, type OpenGame } from '../api/games.js';
import { ApiRequestError } from '../api/http.js';
import { navigate } from '../router.js';
import { authState } from '../state.js';
import { TIME_CONTROLS } from '../timeControls.js';

export async function renderDashboard() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="card">
      <h1>Welcome, ${authState.user?.username}</h1>
      <p class="muted">Rating: ${authState.user?.rating}</p>

      <label>Time control</label>
      <select id="time-control-select">
        ${TIME_CONTROLS.map((tc, i) => `<option value="${i}" ${i === 2 ? 'selected' : ''}>${tc.label}</option>`).join('')}
      </select>

      <button id="create-game-btn">Create game</button>
      <div class="error" id="dash-error"></div>
    </div>

    <div class="card">
      <h2>Join a game by code</h2>
      <input type="text" id="join-code-input" placeholder="e.g. 7K3M9P" maxlength="10" style="text-transform: uppercase;" />
      <button id="join-code-btn" class="secondary">Go to game</button>
    </div>

    <div class="card">
      <h2>Open games</h2>
      <div id="open-games-list" class="muted">Loading…</div>
    </div>
  `;

  const errorEl = document.getElementById('dash-error')!;
  const selectEl = document.getElementById('time-control-select') as HTMLSelectElement;

  document.getElementById('create-game-btn')!.addEventListener('click', async () => {
    const tc = TIME_CONTROLS[Number(selectEl.value)];
    try {
      const { joinCode } = await createGame({
        baseMinutes: tc.baseMinutes,
        incrementSeconds: tc.incrementSeconds,
      });
      navigate(`/game/${joinCode}`);
    } catch (err) {
      errorEl.textContent = err instanceof ApiRequestError ? err.message : 'Could not create game';
    }
  });

  document.getElementById('join-code-btn')!.addEventListener('click', () => {
    const input = document.getElementById('join-code-input') as HTMLInputElement;
    const code = input.value.trim().toUpperCase();
    if (code) navigate(`/game/${code}`);
  });

  await refreshOpenGames();
}

async function refreshOpenGames() {
  const list = document.getElementById('open-games-list');
  if (!list) return;

  try {
    const { games } = await listOpenGames();
    if (games.length === 0) {
      list.innerHTML = '<p class="muted">No open games right now. Create one!</p>';
      return;
    }
    list.innerHTML = games.map(gameRow).join('');

    list.querySelectorAll<HTMLButtonElement>('button[data-join]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const gameId = btn.dataset.join!;
        try {
          const result = await joinGame(gameId);
          navigate(`/game/${result.joinCode}`);
        } catch (err) {
          alert(err instanceof ApiRequestError ? err.message : 'Could not join game');
        }
      });
    });
  } catch {
    list.innerHTML = '<p class="error">Failed to load open games.</p>';
  }
}

function gameRow(game: OpenGame): string {
  return `
    <div class="row">
      <span>${game.white.username} <span class="muted">(${game.white.rating})</span></span>
      <button data-join="${game._id}">Join</button>
    </div>
  `;
}

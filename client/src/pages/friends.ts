import { listFriends, listIncomingRequests, respondToFriendRequest, type Friend, type IncomingRequest } from '../api/friends.js';
import { connectSocket } from '../socket.js';
import { navigate } from '../router.js';
import { TIME_CONTROLS } from '../timeControls.js';

export async function renderFriends() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="card">
      <h1>Friend requests</h1>
      <div id="requests-list" class="muted">Loading…</div>
    </div>
    <div class="card">
      <h1>Friends</h1>
      <label>Challenge time control</label>
      <select id="challenge-tc-select">
        ${TIME_CONTROLS.map((tc, i) => `<option value="${i}" ${i === 2 ? 'selected' : ''}>${tc.label}</option>`).join('')}
      </select>
      <div id="friends-list" class="muted">Loading…</div>
    </div>
  `;

  await Promise.all([refreshRequests(), refreshFriends()]);

  const socket = connectSocket();

  socket.off('friend:request_received');
  socket.off('friend:presence');
  socket.off('challenge:sent');
  socket.off('challenge:error');

  socket.on('friend:request_received', () => refreshRequests());
  socket.on('friend:presence', () => refreshFriends());
  socket.on('challenge:sent', () => {
    setStatus('Challenge sent — waiting for a response…');
  });
  socket.on('challenge:error', (payload: { message: string }) => {
    setStatus(payload.message, true);
  });
}

function setStatus(message: string, isError = false) {
  let el = document.getElementById('friends-status');
  if (!el) {
    el = document.createElement('p');
    el.id = 'friends-status';
    document.getElementById('app')?.prepend(el);
  }
  el.className = isError ? 'error' : 'ok';
  el.textContent = message;
}

async function refreshRequests() {
  const el = document.getElementById('requests-list');
  if (!el) return;
  const { requests } = await listIncomingRequests();

  if (requests.length === 0) {
    el.innerHTML = '<p class="muted">No pending requests.</p>';
    return;
  }

  el.innerHTML = requests.map(requestRow).join('');
  el.querySelectorAll<HTMLButtonElement>('button[data-accept]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await respondToFriendRequest(btn.dataset.accept!, true);
      await Promise.all([refreshRequests(), refreshFriends()]);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('button[data-decline]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await respondToFriendRequest(btn.dataset.decline!, false);
      await refreshRequests();
    }),
  );
}

function requestRow(r: IncomingRequest): string {
  return `
    <div class="row">
      <span>${r.from.username} <span class="muted">(${r.from.rating})</span></span>
      <span>
        <button data-accept="${r._id}">Accept</button>
        <button class="secondary" data-decline="${r._id}">Decline</button>
      </span>
    </div>
  `;
}

async function refreshFriends() {
  const el = document.getElementById('friends-list');
  if (!el) return;
  const { friends } = await listFriends();

  if (friends.length === 0) {
    el.innerHTML = '<p class="muted">No friends yet. Find players and add some!</p>';
    return;
  }

  el.innerHTML = friends.map(friendRow).join('');

  el.querySelectorAll<HTMLButtonElement>('button[data-challenge]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const select = document.getElementById('challenge-tc-select') as HTMLSelectElement;
      const tc = TIME_CONTROLS[Number(select.value)];
      const socket = connectSocket();
      socket.emit('challenge:send', {
        toUserId: btn.dataset.challenge,
        baseMinutes: tc.baseMinutes,
        incrementSeconds: tc.incrementSeconds,
      });
      setStatus(`Challenge sent (${tc.label}) — waiting for a response…`);
    }),
  );
}

function friendRow(f: Friend): string {
  return `
    <div class="row">
      <span>
        <span class="dot ${f.online ? 'online' : ''}"></span>${f.username}
        <span class="muted">(${f.rating})</span>
      </span>
      <span>
        <a href="#/profile/${encodeURIComponent(f.username)}"><button class="secondary">Profile</button></a>
        <button data-challenge="${f.id}" ${f.online ? '' : 'disabled'}>Challenge</button>
      </span>
    </div>
  `;
}

export function setupGlobalChallengeListeners() {
  const socket = connectSocket();

  socket.off('challenge:received');
  socket.off('challenge:accepted');

  socket.on('challenge:received', (payload: { challengeId: string; from: { username: string } }) => {
    const accept = confirm(`${payload.from.username} challenged you to a game. Accept?`);
    socket.emit('challenge:respond', { challengeId: payload.challengeId, accept });
  });

  socket.on('challenge:accepted', (payload: { joinCode: string }) => {
    navigate(`/game/${payload.joinCode}`);
  });
}

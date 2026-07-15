import { searchUsers, getProfile } from '../api/users.js';
import { sendFriendRequest } from '../api/friends.js';
import { ApiRequestError } from '../api/http.js';
import { navigate } from '../router.js';

export function renderProfileSearch() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="card">
      <h1>Find players</h1>
      <input type="text" id="search-input" placeholder="Search by username…" />
      <div id="search-results"></div>
    </div>
  `;

  const input = document.getElementById('search-input') as HTMLInputElement;
  const results = document.getElementById('search-results')!;
  let debounceTimer: number | undefined;

  input.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length === 0) {
      results.innerHTML = '';
      return;
    }
    debounceTimer = window.setTimeout(async () => {
      try {
        const { users } = await searchUsers(q);
        results.innerHTML = users.length
          ? users
              .map(
                (u) => `
                <div class="row">
                  <span>${u.username} <span class="muted">(${u.rating})</span></span>
                  <a href="#/profile/${encodeURIComponent(u.username)}"><button class="secondary">View</button></a>
                </div>`,
              )
              .join('')
          : '<p class="muted">No users found.</p>';
      } catch {
        results.innerHTML = '<p class="error">Search failed.</p>';
      }
    }, 250);
  });
}

export async function renderProfile(params: { username: string }) {
  const app = document.getElementById('app')!;
  app.innerHTML = `<div class="card muted">Loading profile…</div>`;

  try {
    const profile = await getProfile(params.username);
    app.innerHTML = `
      <div class="card">
        <h1>${profile.username}</h1>
        <p class="muted">Rating: ${profile.rating} · Member since ${new Date(profile.memberSince).toLocaleDateString()}</p>
        <p class="muted">${profile.stats.gamesPlayed} games played · ${profile.stats.wins} wins</p>
        ${
          profile.isSelf
            ? ''
            : profile.isFriend
              ? '<p class="ok">✓ Friends</p>'
              : `<button id="add-friend-btn">Add friend</button>`
        }
        <div class="error" id="profile-error"></div>
      </div>
      <p><a href="#/find">← Back to search</a></p>
    `;

    const btn = document.getElementById('add-friend-btn');
    btn?.addEventListener('click', async () => {
      const errorEl = document.getElementById('profile-error')!;
      try {
        await sendFriendRequest(profile.id);
        btn.replaceWith(Object.assign(document.createElement('p'), {
          className: 'ok',
          textContent: '✓ Friend request sent',
        }));
      } catch (err) {
        errorEl.textContent = err instanceof ApiRequestError ? err.message : 'Could not send request';
      }
    });
  } catch (err) {
    app.innerHTML = `<div class="card error">${err instanceof ApiRequestError ? err.message : 'Profile not found'}</div>`;
  }
}

export function goToProfile(username: string) {
  navigate(`/profile/${username}`);
}

import { route, navigate, startRouter } from './router.js';
import { authState } from './state.js';
import { tryRestoreSession, logout } from './api/auth.js';
import { connectSocket, disconnectSocket } from './socket.js';
import { renderSignin } from './pages/signin.js';
import { renderSignup } from './pages/signup.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderProfileSearch, renderProfile } from './pages/profile.js';
import { renderFriends, setupGlobalChallengeListeners } from './pages/friends.js';
import { renderGame } from './pages/game.js';

function renderNavbar() {
  const nav = document.getElementById('navbar')!;
  if (!authState.isAuthed) {
    nav.innerHTML = `
      <span class="brand">♟ Chess App</span>
      <a href="#/signin">Sign in</a>
      <a href="#/signup">Sign up</a>
    `;
    return;
  }

  nav.innerHTML = `
    <span class="brand">♟ Chess App</span>
    <a href="#/dashboard">Dashboard</a>
    <a href="#/find">Find players</a>
    <a href="#/friends">Friends</a>
    <span class="spacer"></span>
    <span class="muted">${authState.user?.username}</span>
    <a href="#" id="logout-link">Log out</a>
  `;

  document.getElementById('logout-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await logout();
    disconnectSocket();
    navigate('/signin');
  });
}

function requireAuthGuard(render: (params: Record<string, string>) => void) {
  return (params: Record<string, string>) => {
    if (!authState.isAuthed) {
      navigate('/signin');
      return;
    }
    render(params);
  };
}

route('/', () => navigate(authState.isAuthed ? '/dashboard' : '/signin'));
route('/signin', () => (authState.isAuthed ? navigate('/dashboard') : renderSignin()));
route('/signup', () => (authState.isAuthed ? navigate('/dashboard') : renderSignup()));
route('/dashboard', requireAuthGuard(renderDashboard));
route('/find', requireAuthGuard(renderProfileSearch));
route('/profile/:username', requireAuthGuard(renderProfile));
route('/friends', requireAuthGuard(renderFriends));
route('/game/:gameId', requireAuthGuard(renderGame));

authState.subscribe(() => {
  renderNavbar();
  if (authState.isAuthed) {
    connectSocket();
    setupGlobalChallengeListeners();
  }
});

async function bootstrap() {
  await tryRestoreSession();
  renderNavbar();
  startRouter();
}

void bootstrap();

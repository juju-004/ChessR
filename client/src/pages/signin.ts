import { signin } from '../api/auth.js';
import { ApiRequestError } from '../api/http.js';
import { navigate } from '../router.js';

export function renderSignin() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="card">
      <h1>Sign in</h1>
      <form id="signin-form">
        <label>Email</label>
        <input type="email" name="email" required autocomplete="email" />
        <label>Password</label>
        <input type="password" name="password" required autocomplete="current-password" />
        <div class="error" id="signin-error"></div>
        <button type="submit">Sign in</button>
      </form>
      <p class="muted">No account? <a href="#/signup">Sign up</a></p>
    </div>
  `;

  const form = document.getElementById('signin-form') as HTMLFormElement;
  const errorEl = document.getElementById('signin-error')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const data = new FormData(form);
    try {
      await signin(String(data.get('email')), String(data.get('password')));
      navigate('/dashboard');
    } catch (err) {
      errorEl.textContent = err instanceof ApiRequestError ? err.message : 'Sign in failed';
    }
  });
}

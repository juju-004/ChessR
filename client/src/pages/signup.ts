import { signup } from '../api/auth.js';
import { ApiRequestError } from '../api/http.js';
import { navigate } from '../router.js';

export function renderSignup() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="card">
      <h1>Create account</h1>
      <form id="signup-form">
        <label>Username</label>
        <input type="text" name="username" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" />
        <label>Email</label>
        <input type="email" name="email" required autocomplete="email" />
        <label>Password</label>
        <input type="password" name="password" required minlength="8" autocomplete="new-password" />
        <div class="error" id="signup-error"></div>
        <button type="submit">Sign up</button>
      </form>
      <p class="muted">Already have an account? <a href="#/signin">Sign in</a></p>
    </div>
  `;

  const form = document.getElementById('signup-form') as HTMLFormElement;
  const errorEl = document.getElementById('signup-error')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const data = new FormData(form);
    try {
      await signup(String(data.get('username')), String(data.get('email')), String(data.get('password')));
      navigate('/dashboard');
    } catch (err) {
      errorEl.textContent = err instanceof ApiRequestError ? err.message : 'Sign up failed';
    }
  });
}

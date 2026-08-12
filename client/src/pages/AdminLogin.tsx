import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { adminLogin } from "../api/admin.js";
import { ApiRequestError } from "../api/http.js";
import { Card, Button } from "../components/ui/index.js";

export function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await adminLogin(username, password);
      const redirectTo = (location.state as any)?.from ?? "/admin";
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-base-300 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex flex-col items-center gap-2 text-base-content">
          <ShieldCheck className="h-8 w-8 text-(--primary)" />
          <h1 className="text-lg font-semibold">Chessr review console</h1>
          <p className="text-center text-xs text-base-content/50">
            Internal tool for reviewing reported games. Not a player account.
          </p>
        </div>
        <Card variant="solid">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="admin-username" className="mb-1 block text-sm font-medium text-base-content/80">
                Username
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-base-content/80">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" disabled={loading} className="mt-1">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

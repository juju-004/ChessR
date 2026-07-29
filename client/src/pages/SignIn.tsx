import { useState, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { signin } from "../api/auth.js";
import { isLoggedIn } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { Card, Input, Button } from "../components/ui/index.js";

export function SignIn() {
  const navigate = useNavigate();

  // Same guard as SignUp — a logged-in user hitting /signin has nothing to
  // do here.
  if (isLoggedIn()) return <Navigate to="/" replace />;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signin(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card variant="solid" className="mx-auto mt-8 max-w-md">
      <h1 className="mb-4 text-2xl font-bold text-base-content">Sign in</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" fullWidth loading={loading}>
          Sign in
        </Button>
      </form>
      <p className="mt-3 text-sm text-base-content/60">
        No account?{" "}
        <Link to="/signup" className="text-(--primary) hover:underline">
          Sign up
        </Link>
      </p>
    </Card>
  );
}

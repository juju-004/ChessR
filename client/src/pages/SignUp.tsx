import { useState, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { signup } from "../api/auth.js";
import { isLoggedIn } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { Card, Input, Button } from "../components/ui/index.js";

export function SignUp() {
  const navigate = useNavigate();

  // Already signed in? There's nothing for this page to do — bounce straight
  // to the dashboard instead of showing a signup form to someone who doesn't
  // need one.
  if (isLoggedIn()) return <Navigate to="/" replace />;

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup(username, email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card variant="solid" className="mx-auto mt-8 max-w-md">
      <h1 className="mb-4 text-2xl font-bold text-base-content">
        Create account
      </h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          label="Username"
          type="text"
          required
          minLength={3}
          maxLength={24}
          pattern="[a-zA-Z0-9_]+"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
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
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" fullWidth loading={loading}>
          Sign up
        </Button>
      </form>
      <p className="mt-3 text-sm text-base-content/60">
        Already have an account?{" "}
        <Link to="/signin" className="text-(--primary) hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}

import { useState, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { signin } from "../api/auth.js";
import { isLoggedIn } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { Input, Button } from "../components/ui/index.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { Mail, LockOpen, Eye, EyeOff, AlertCircle } from "lucide-react";

export function SignIn() {
  const navigate = useNavigate();

  // Same guard as SignUp — a logged-in user hitting /signin has nothing to
  // do here.
  if (isLoggedIn()) return <Navigate to="/" replace />;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to jump back into your games."
      footer={
        <>
          No account?{" "}
          <Link to="/signup" className="font-medium text-(--primary) hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          leadingIcon={<Mail className="size-4" />}
          placeholder="you@example.com"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type={showPassword ? "text" : "password"}
          leadingIcon={<LockOpen className="size-4" />}
          trailingIcon={showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          onTrailingIconClick={() => setShowPassword((v) => !v)}
          trailingIconLabel={showPassword ? "Hide password" : "Show password"}
          placeholder="••••••••"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-500">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" fullWidth loading={loading} size="lg">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

import { useState, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { signin, googleSignin } from "../api/auth.js";
import { isLoggedIn } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { Input, Button } from "../components/ui/index.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { GoogleSignInButton } from "../components/GoogleSignInButton.js";
import { User2, LockOpen, Eye, EyeOff, AlertCircle } from "lucide-react";

export function SignIn() {
  const navigate = useNavigate();

  // Same guard as SignUp, a logged-in user hitting /signin has nothing to
  // do here.
  if (isLoggedIn()) return <Navigate to="/" replace />;

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signin(identifier, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    setError("");
    setLoading(true);
    try {
      const { isNewUser } = await googleSignin(credential);
      // Fresh account: its username was auto-generated from the Google
      // profile name/email, never actually chosen by them, send them
      // through the one-time picker before the dashboard. An existing
      // account signing in with Google for the first time already has a
      // real username, so it skips straight through.
      navigate(isNewUser ? "/choose-username" : "/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Google sign in failed");
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
          label="Username or email"
          type="text"
          leadingIcon={<User2 className="size-4" />}
          placeholder="you@example.com or your_username"
          required
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
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

      <div className="my-5 flex items-center gap-3 text-xs text-base-content/40">
        <div className="h-px flex-1 bg-base-300" />
        or
        <div className="h-px flex-1 bg-base-300" />
      </div>

      <GoogleSignInButton text="signin_with" onCredential={handleGoogleCredential} />
    </AuthLayout>
  );
}

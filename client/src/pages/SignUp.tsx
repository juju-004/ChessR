import { useState, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { signup } from "../api/auth.js";
import { isLoggedIn } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { Input, Button } from "../components/ui/index.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { LockOpen, Mail, User2, Eye, EyeOff, AlertCircle } from "lucide-react";

export function SignUp() {
  const navigate = useNavigate();

  // Already signed in? There's nothing for this page to do — bounce straight
  // to the dashboard instead of showing a signup form to someone who doesn't
  // need one.
  if (isLoggedIn()) return <Navigate to="/" replace />;

  const [username, setUsername] = useState("");
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
      await signup(username, email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join up and get your first game going in seconds."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/signin" className="font-medium text-(--primary) hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Username"
          type="text"
          required
          leadingIcon={<User2 className="size-4" />}
          placeholder="Your username"
          minLength={3}
          maxLength={24}
          pattern="[a-zA-Z0-9_]+"
          hint="3-24 characters — letters, numbers, and underscores only."
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
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
          placeholder="At least 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
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
          Create account
        </Button>

        <p className="text-center text-xs text-base-content/50">
          By signing up, you agree to our{" "}
          <Link
            to="/terms"
            className="font-medium text-(--primary) hover:underline"
          >
            Terms of Service
          </Link>{" "}
          — server-side move validation means everyone plays fair, and
          everyone else does too.
        </p>
      </form>
    </AuthLayout>
  );
}

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.js";
import { updateMyProfile } from "../api/users.js";
import { updateAuthUser } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { Input, Button } from "../components/ui/index.js";
import { AuthLayout } from "../components/AuthLayout.js";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * One-time stop between a brand-new Google signup and the dashboard, 
 * SignIn.tsx/SignUp.tsx route here instead of "/" specifically when
 * auth.controller.ts's googleSignin reports `isNewUser`, since a fresh
 * account's username is just auto-generated from their Google name/email
 * (see generateAvailableUsername on the server) and was never actually
 * chosen by them. An existing account's later Google sign-ins skip this
 * entirely and land straight on the dashboard.
 *
 * Deliberately skippable, "player4821" is a perfectly working account,
 * not a broken one, so this never blocks getting into the app.
 */
export function ChooseUsername() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(user?.username ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const trimmed = username.trim();
  const isUnchanged = trimmed === user?.username;
  const isValid =
    trimmed.length >= 3 &&
    trimmed.length <= 24 &&
    USERNAME_PATTERN.test(trimmed);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || isUnchanged) {
      navigate("/", { replace: true });
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await updateMyProfile({ username: trimmed });
      updateAuthUser({ username: result.username });
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not save that username",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout
      title="Pick a username"
      subtitle={`We started you off with "${user?.username ?? ""}" from your Google account. Make it yours, or keep it.`}
      footer=""
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          autoFocus
          label="Username"
          leadingIcon={<Sparkles className="h-4 w-4" />}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={24}
        />
        <p className="text-xs text-base-content/50">
          3–24 characters, letters, numbers, and underscores only.
        </p>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <Button
          type="submit"
          fullWidth
          loading={saving}
          disabled={!isValid}
          size="lg"
        >
          {isUnchanged ? "Continue" : "Save and continue"}
        </Button>

        {!isUnchanged && (
          <button
            type="button"
            onClick={() => navigate("/", { replace: true })}
            className="text-center text-sm text-base-content/50 hover:text-base-content/70"
          >
            Skip for now, keep "{user?.username}" instead
          </button>
        )}
      </form>
    </AuthLayout>
  );
}

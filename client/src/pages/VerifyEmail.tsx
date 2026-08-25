import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { verifyEmail, resendVerificationEmail } from "../api/auth.js";
import { useAuth } from "../contexts/AuthContext.js";
import { ApiRequestError } from "../api/http.js";
import { Button } from "../components/ui/index.js";
import { AuthLayout } from "../components/AuthLayout.js";

type Status = "loading" | "success" | "error";

/**
 * Landing page for the link in the verification email (see
 * verification.service.ts on the server, the link is
 * `${CLIENT_ORIGIN}/verify-email?token=...`). Works whether or not the
 * person happens to be signed in on this device/browser right now, the
 * server endpoint itself needs no auth, only a valid token, since the
 * email is just as likely to be opened on a different device than the one
 * that signed up.
 */
export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { isAuthed } = useAuth();

  const [status, setStatus] = useState<Status>(token ? "loading" : "error");
  const [errorMessage, setErrorMessage] = useState(
    token ? "" : "This verification link is missing its token.",
  );
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    verifyEmail(token)
      .then(() => {
        if (!cancelled) setStatus("success");
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(
          err instanceof ApiRequestError
            ? err.message
            : "This verification link is invalid or has expired.",
        );
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleResend() {
    setResendState("sending");
    try {
      await resendVerificationEmail();
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  }

  return (
    <AuthLayout
      title={
        status === "loading"
          ? "Confirming your email…"
          : status === "success"
            ? "Email confirmed"
            : "Verification link didn't work"
      }
      subtitle={
        status === "loading"
          ? "One moment."
          : status === "success"
            ? "You're all set, your address is confirmed."
            : errorMessage
      }
      footer={
        isAuthed ? (
          <Link to="/" className="font-medium text-(--primary) hover:underline">
            Back to dashboard
          </Link>
        ) : (
          <>
            Have an account?{" "}
            <Link to="/signin" className="font-medium text-(--primary) hover:underline">
              Sign in
            </Link>
          </>
        )
      }
    >
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        {status === "loading" && (
          <Loader2 className="size-12 animate-spin text-base-content/30" />
        )}
        {status === "success" && <CheckCircle2 className="size-12 text-green-500" />}
        {status === "error" && (
          <>
            <XCircle className="size-12 text-red-500" />
            {isAuthed && (
              <Button
                variant="ghost"
                size="sm"
                loading={resendState === "sending"}
                disabled={resendState === "sent"}
                onClick={handleResend}
              >
                {resendState === "sent" ? "New link sent. Check your inbox" : "Send a new link"}
              </Button>
            )}
          </>
        )}
        {status === "success" && (
          <Link to="/" className="w-full">
            <Button fullWidth>Continue</Button>
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}

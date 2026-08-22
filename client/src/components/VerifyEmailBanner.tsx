import { useState } from "react";
import { MailWarning } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.js";
import { resendVerificationEmail } from "../api/auth.js";
import { Button } from "./ui/index.js";

/**
 * Thin, dismissible-by-navigation strip shown across every signed-in page
 * while `user.emailVerified` is false — doesn't block anything (no page
 * this app has actually needs a confirmed address today), just nudges.
 * Renders nothing for a Google sign-in account (always emailVerified:
 * true — see auth.controller.ts's googleSignin) or once the address is
 * confirmed.
 */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  if (!user || user.emailVerified !== false) return null;

  async function handleResend() {
    setState("sending");
    try {
      await resendVerificationEmail();
      setState("sent");
    } catch {
      setState("idle");
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-800/50 bg-amber-950/20 px-4 py-2.5 text-sm text-amber-300">
      <span className="flex items-center gap-2">
        <MailWarning className="h-4 w-4 shrink-0" />
        Confirm your email ({user.email}) to secure your account.
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="text-amber-300 hover:bg-amber-900/40"
        loading={state === "sending"}
        disabled={state === "sent"}
        onClick={handleResend}
      >
        {state === "sent" ? "Sent — check your inbox" : "Resend email"}
      </Button>
    </div>
  );
}

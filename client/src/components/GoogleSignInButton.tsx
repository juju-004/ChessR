import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "../contexts/ThemeContext.js";

// Minimal shape of the bits of Google Identity Services this component
// actually touches — the real script attaches a much bigger `google`
// global, but typing the whole SDK would be overkill for two calls.
interface GoogleIdConfig {
  client_id: string;
  callback: (response: { credential: string }) => void;
}
interface GoogleIdButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_black" | "filled_blue";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with";
  shape?: "rectangular" | "pill";
  width?: number;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfig) => void;
          renderButton: (
            parent: HTMLElement,
            options: GoogleIdButtonOptions,
          ) => void;
        };
      };
    };
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// Loaded at most once per page, no matter how many
// <GoogleSignInButton> instances mount (SignIn + SignUp could both be
// preloaded, an admin surface could add its own, etc.) — every mount
// awaits this same promise instead of racing to inject duplicate
// <script> tags.
let scriptPromise: Promise<void> | null = null;
function loadGsiScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Failed to load Google Identity Services"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface GoogleSignInButtonProps {
  /** "signin_with" for the sign-in page, "signup_with" for the signup
   *  page — purely copy on Google's own rendered button. */
  text?: "signin_with" | "signup_with";
  /** Called with the raw ID token JWT once Google returns one — hand this
   *  straight to api/auth.ts's googleSignin(). Left to the caller (rather
   *  than this component calling the API itself) so SignIn/SignUp can each
   *  own their own loading/error/navigate handling exactly like their
   *  password form already does. */
  onCredential: (credential: string) => void | Promise<void>;
}

/**
 * Renders Google's own "Sign in with Google" button via Google Identity
 * Services — deliberately Google's real button (rendered inside a
 * same-origin iframe it controls), not a lookalike built from this app's
 * Button component, since a custom button triggering the OAuth popup
 * would either need Google's official branding guidelines reproduced
 * exactly or risk looking like a phishing attempt.
 *
 * Renders nothing (not even a placeholder) if VITE_GOOGLE_CLIENT_ID isn't
 * set, so an unconfigured deployment just quietly has one fewer sign-in
 * option instead of showing a button that errors when clicked.
 */
export function GoogleSignInButton({
  text = "signin_with",
  onCredential,
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const { theme } = useTheme();
  const domId = useId();

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !containerRef.current) return;
    let cancelled = false;

    loadGsiScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            void onCredential(response.credential);
          },
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: theme === "dark" ? "filled_black" : "outline",
          size: "large",
          text,
          shape: "pill",
          width: 320,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, theme, text]);

  if (!clientId || failed) return null;

  return (
    <div id={domId} ref={containerRef} className="flex w-full justify-center" />
  );
}

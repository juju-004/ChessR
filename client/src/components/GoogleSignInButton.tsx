import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "../contexts/ThemeContext.js";
import { cn } from "../lib/cn.js";

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

const LABEL: Record<NonNullable<GoogleSignInButtonProps["text"]>, string> = {
  signin_with: "Sign in with Google",
  signup_with: "Sign up with Google",
};

/**
 * A custom-styled, full-width "Continue with Google" button that still
 * performs the actual sign-in through Google's own hosted button.
 *
 * Google's stock `renderButton` only ships a handful of fixed themes
 * (`outline` renders a solid white pill, `filled_black` a solid black one)
 * and a fixed pixel `width` — there's no "transparent" or "match my site"
 * option, and no percentage width. That meant a hard-coded white box in
 * production regardless of the app's theme, sized for a 320px card and
 * clipped/overflowing anywhere narrower.
 *
 * Instead, Google's real button is rendered into an invisible (`opacity-0`)
 * layer stretched to fill this container via a `ResizeObserver`, so it's
 * always exactly as wide as its parent and never shows its own background.
 * A purely decorative button — built from this app's own theme tokens,
 * using Google's official "G" mark per Google's branding guidelines for
 * custom sign-in buttons — sits visually on top but with
 * `pointer-events-none`, so every real click/tap lands on the invisible
 * official button underneath and Google's own iframe still owns the actual
 * OAuth flow.
 *
 * Renders nothing (not even a placeholder) if VITE_GOOGLE_CLIENT_ID isn't
 * set, so an unconfigured deployment just quietly has one fewer sign-in
 * option instead of showing a button that errors when clicked.
 */
export function GoogleSignInButton({
  text = "signin_with",
  onCredential,
}: GoogleSignInButtonProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const { theme } = useTheme();
  const domId = useId();

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  // Track the wrapper's actual rendered width so the invisible Google
  // button underneath is always re-rendered at exactly that width — this
  // is what makes the whole thing responsive instead of stuck at a fixed
  // 320px.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!clientId || !containerRef.current || width === 0) return;
    let cancelled = false;

    loadGsiScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        // Cleared first — renderButton() appends rather than replaces, so
        // without this every width/theme change would stack another
        // hidden iframe on top of the last one.
        containerRef.current.innerHTML = "";
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
          width,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, theme, text, width]);

  if (!clientId || failed) return null;

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* Decorative button — matches the app's theme, never shows Google's
       *  own white/black fill. Purely visual: clicks pass through to the
       *  real button beneath it. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none flex h-12 w-full items-center justify-center gap-3 rounded-full",
          "border border-base-300 bg-transparent text-sm font-semibold text-base-content",
        )}
      >
        <GoogleGlyph className="size-[18px] shrink-0" />
        {LABEL[text]}
      </div>
      {/* Google's real, official button — kept fully functional and
       *  accessible, just visually invisible and stretched to match the
       *  decorative button above via `width`. */}
      <div
        id={domId}
        ref={containerRef}
        className="absolute inset-0 overflow-hidden rounded-full opacity-0"
      />
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

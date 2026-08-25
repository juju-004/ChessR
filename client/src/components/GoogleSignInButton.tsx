import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext.js";
import { cn } from "../lib/cn.js";

// Minimal shape of the bits of Google Identity Services this component
// actually touches, the real script attaches a much bigger `google`
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
// preloaded, an admin surface could add its own, etc.), every mount
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
   *  page, purely copy on Google's own rendered button. */
  text?: "signin_with" | "signup_with";
  /** Called with the raw ID token JWT once Google returns one, hand this
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
 * A responsive "Continue with Google" button that renders Google's own
 * hosted button, the real, actually-clickable one, not a lookalike.
 *
 * An earlier version of this rendered Google's real button into an
 * `opacity-0` layer and drew a purely decorative, full-width, theme-matched
 * button on top of it, on the theory that clicks would just pass through
 * to the invisible one underneath. That doesn't hold up in practice:
 * Google's iframe renders at its own fixed intrinsic size *inside* that
 * layer, it doesn't stretch to fill it, so only the exact pixels the
 * iframe actually occupies were ever clickable, not the full visible
 * button drawn on top of it. That's what showed up as "keep clicking and
 * nothing happens": most taps were landing on dead space around the real
 * button, not on it.
 *
 * This version renders Google's real button directly (visible, so every
 * pixel of it is genuinely clickable), just measured and re-rendered at
 * the container's actual width via `ResizeObserver`, width is the one
 * thing `renderButton` won't do responsively on its own, it only accepts
 * a fixed pixel number. A rounded/clipped wrapper keeps its edges tidy
 * against the rest of the form instead of leaving Google's default square
 * corners butted up against everything else. Google's fixed color themes
 * (`outline` white / `filled_black` black) are otherwise left alone, 
 * there's no third-party "transparent" or "match my site" option to lean
 * on, and no reliable way to fake one without breaking clicks again.
 *
 * Until Google's button has actually finished loading and rendering, a
 * disabled-looking skeleton with a spinner sits in its place, same size,
 * same border, so there's nothing to click yet rather than a button that
 * looks ready but silently does nothing while the script is still loading.
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
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  const { theme } = useTheme();
  const domId = useId();

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  // Track the wrapper's actual rendered width so Google's button is always
  // re-rendered at exactly that width, this is what makes it responsive
  // instead of stuck at a fixed 320px.
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
    setReady(false);

    loadGsiScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        // Cleared first, renderButton() appends rather than replaces, so
        // without this every width/theme change would stack another
        // button underneath the last one.
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
        setReady(true);
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
    <div ref={wrapperRef} className="relative h-12 w-full">
      {/* Loading skeleton, same footprint as the real button, visibly
       *  disabled (muted, spinner, not-allowed cursor) so it's obvious
       *  there's nothing to click yet rather than a button that looks
       *  ready and just silently eats taps while the script loads. */}
      {!ready && (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-full",
            "border border-base-300 bg-base-200/50 text-sm font-medium text-base-content/40",
            "cursor-not-allowed select-none",
          )}
        >
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {LABEL[text]}
        </div>
      )}
      {/* Google's real, official, fully clickable button. Visible only
       *  once it's actually rendered (see `ready` above), kept mounted
       *  underneath the skeleton the whole time so `containerRef` is
       *  always attached for the effect above to render into, just
       *  invisible and non-interactive until there's really something
       *  there to click. */}
      <div
        id={domId}
        ref={containerRef}
        className={cn(
          "absolute inset-0 flex items-center justify-center overflow-hidden rounded-full transition-opacity",
          ready ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
    </div>
  );
}


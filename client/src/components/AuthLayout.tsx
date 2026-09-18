import type { ReactNode } from "react";
import { Card } from "./ui/index.js";

interface AuthLayoutProps {
  title: string;
  /** Optional — SignIn/SignUp deliberately go title-only (just "Login" /
   *  "Register", no descriptive line under it); VerifyE  /, mail and
   *  ChooseUsername still pass one since their pages need the extra
   *  context. */
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * The shared shell behind SignIn/SignUp: a big centered logo, the form
 * card underneath it, all sitting over a decorative background.
 *
 * CURRENT background — the original "paint stripe" bars, brought back per
 * request, just smaller than the original size (h-56/h-40/h-64 and
 * w-280/w-240 shrunk down) so they read as accents instead of dominating
 * the screen.
 *
 * PREVIOUS background — two clusters of layered wave shapes anchored to
 * opposite (cross-diagonal) corners of the screen, tried in between the
 * two paint-stripe versions above. Commented out (not deleted) in case
 * we want to bring it back again later:
 *
 *   <div
 *     aria-hidden="true"
 *     className="pointer-events-none opacity-40 fixed inset-0 z-0"
 *   >
 *     <svg
 *       className="absolute -left-24 -top-24 h-100 w-100 sm:h-120 sm:w-120"
 *       viewBox="0 0 400 400"
 *       xmlns="http://www.w3.org/2000/svg"
 *     >
 *       <path
 *         d="M0,120 C60,80 100,160 160,120 C220,80 260,160 320,120 C350,100 380,110 400,120 L400,0 L0,0 Z"
 *         style={{ fill: "var(--primary)" }}
 *         opacity="0.85"
 *       />
 *       <path
 *         d="M0,180 C50,150 110,210 170,180 C230,150 270,210 330,180 C360,165 385,172 400,180 L400,0 L0,0 Z"
 *         style={{ fill: "var(--secondary)" }}
 *         opacity="0.55"
 *       />
 *       <path
 *         d="M0,240 C45,215 115,265 175,240 C235,215 280,265 340,240 C365,228 385,233 400,240 L400,0 L0,0 Z"
 *         style={{ fill: "var(--primary-light)" }}
 *         opacity="0.35"
 *       />
 *     </svg>
 *     <svg
 *       className="absolute -right-24 -bottom-24 h-100 w-100 sm:h-120 sm:w-120 rotate-180"
 *       viewBox="0 0 400 400"
 *       xmlns="http://www.w3.org/2000/svg"
 *     >
 *       <path
 *         d="M0,120 C60,80 100,160 160,120 C220,80 260,160 320,120 C350,100 380,110 400,120 L400,0 L0,0 Z"
 *         style={{ fill: "var(--secondary)" }}
 *         opacity="0.85"
 *       />
 *       <path
 *         d="M0,180 C50,150 110,210 170,180 C230,150 270,210 330,180 C360,165 385,172 400,180 L400,0 L0,0 Z"
 *         style={{ fill: "var(--primary)" }}
 *         opacity="0.55"
 *       />
 *       <path
 *         d="M0,240 C45,215 115,265 175,240 C235,215 280,265 340,240 C365,228 385,233 400,240 L400,0 L0,0 Z"
 *         style={{ fill: "var(--secondary-light)" }}
 *         opacity="0.35"
 *       />
 *     </svg>
 *   </div>
 *
 * ORIGINAL SIZE paint stripes — the very first version, before either of
 * the above, in case the smaller size below ever needs to go back to this:
 *
 *   <div
 *     aria-hidden="true"
 *     className="pointer-events-none opacity-30 fixed inset-0 z-0"
 *   >
 *     <div
 *       className="absolute -left-24 -top-42 sm:-top-32 h-56 w-280 -rotate-10 rounded-full opacity-90"
 *       style={{
 *         backgroundImage:
 *           "linear-gradient(100deg, var(--primary), var(--secondary))",
 *       }}
 *     />
 *     <div
 *       className="absolute -right-32 top-1/3 h-40 w-240 rotate-[8deg] rounded-full opacity-70"
 *       style={{
 *         backgroundImage:
 *           "linear-gradient(100deg, var(--secondary), var(--primary-light))",
 *       }}
 *     />
 *     <div
 *       className="absolute -left-40 -bottom-40 h-64 w-280 -rotate-6 rounded-full opacity-80"
 *       style={{
 *         backgroundImage:
 *           "linear-gradient(100deg, var(--primary-light), var(--secondary-light))",
 *       }}
 *     />
 *   </div>
 */
export function AuthLayout({ subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-base-100 px-5 py-12">
      {/* Decorative background, a handful of oversized rounded bars,
       *  rotated and offset past the edges of the viewport, each filled
       *  with the brand gradient at a different angle/opacity so they
       *  read as loose overlapping paint strokes rather than a grid.
       *  Sized down from the original (h-56/w-280 etc.) so they sit in
       *  the background as accents rather than dominating the screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none opacity-30 fixed inset-0 z-0"
      >
        <div
          className="absolute -left-16 -top-28 sm:-top-20 h-32 w-160 -rotate-10 rounded-full opacity-90"
          style={{
            backgroundImage:
              "linear-gradient(100deg, var(--primary), var(--secondary))",
          }}
        />
        <div
          className="absolute -right-20 top-1/3 h-24 w-140 rotate-[8deg] rounded-full opacity-70"
          style={{
            backgroundImage:
              "linear-gradient(100deg, var(--secondary), var(--primary-light))",
          }}
        />
        <div
          className="absolute -left-24 -bottom-24 h-36 w-160 -rotate-6 rounded-full opacity-80"
          style={{
            backgroundImage:
              "linear-gradient(100deg, var(--primary-light), var(--secondary-light))",
          }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <img src="/logo.png" className="mb-8 w-56 " alt="App Logo" />

        <Card variant="strong" className="w-full rounded-3xl p-7 sm:p-8">
          {subtitle && (
            <p className="mt-1 mb-6 text-center text-sm text-base-content/60">
              {subtitle}
            </p>
          )}

          {children}

          <div className="pt-5 text-center text-sm text-base-content/60">
            {footer}
          </div>
        </Card>
      </div>
    </div>
  );
}

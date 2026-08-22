import type { ReactNode } from "react";
import { Card } from "./ui/index.js";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * The shared shell behind SignIn/SignUp: a big centered logo, the form
 * card underneath it, all sitting over a few solid diagonal "paint
 * stripe" bands in the brand gradient. The stripes are plain rotated
 * divs with a gradient background — no images, no filter: blur, no
 * backdrop-filter — so this is as cheap to paint as a flat color.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-base-100 px-5 py-12">
      {/* Decorative background — a handful of oversized rounded bars,
       *  rotated and offset past the edges of the viewport, each filled
       *  with the brand gradient at a different angle/opacity so they
       *  read as loose overlapping paint strokes rather than a grid. */}
      <div
        aria-hidden="true"
        className="pointer-events-none opacity-30 fixed inset-0 z-0"
      >
        <div
          className="absolute -left-24 -top-42 sm:-top-32 h-56 w-280 -rotate-10 rounded-full opacity-90"
          style={{
            backgroundImage:
              "linear-gradient(100deg, var(--primary), var(--secondary))",
          }}
        />
        <div
          className="absolute -right-32 top-1/3 h-40 w-240 rotate-[8deg] rounded-full opacity-70"
          style={{
            backgroundImage:
              "linear-gradient(100deg, var(--secondary), var(--primary-light))",
          }}
        />
        <div
          className="absolute -left-40 -bottom-40 h-64 w-280 -rotate-6 rounded-full opacity-80"
          style={{
            backgroundImage:
              "linear-gradient(100deg, var(--primary-light), var(--secondary-light))",
          }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <img src="/logo.png" className="mb-8 w-56 " alt="App Logo" />

        <Card variant="strong" className="w-full rounded-3xl p-7 sm:p-8">
          <h1 className="text-center text-2xl font-bold text-base-content">
            {title}
          </h1>
          <p className="mt-1 mb-6 text-center text-sm text-base-content/60">
            {subtitle}
          </p>

          {children}

          <div className="pt-5 text-center text-sm text-base-content/60">
            {footer}
          </div>
        </Card>
      </div>
    </div>
  );
}

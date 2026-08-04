import { Outlet, useLocation } from "react-router-dom";
import { WalletNav } from "./WalletNav.js";

/**
 * Wraps the three wallet routes (buy/withdraw/transactions) so `WalletNav`
 * — the balance chip + the sliding Buy/Withdraw/History tab pill — mounts
 * once and stays mounted while navigating between them, instead of each
 * page rendering its own copy.
 *
 * That used to be the bug: three separate pages each rendered `<WalletNav>`
 * inside their own `<Page>`, so switching tabs unmounted the whole tree —
 * tab bar included — and remounted a fresh one, at the exact same time
 * `Page`'s own fade+slide-up entrance animation was running on the *y*
 * axis. The tab pill's sliding indicator (`Tabs`' shared `layoutId`
 * animation) needs a single continuously-mounted instance to interpolate
 * between positions on the *x* axis smoothly; fighting a remount and a
 * simultaneous y-transform at once is exactly what made it look distorted
 * and stuttery. Hoisting `WalletNav` up here means it never unmounts on
 * these routes — only `<Outlet />`'s content does — so the pill just
 * glides, decoupled from each page's own entrance animation.
 */
export function WalletLayout() {
  const location = useLocation();
  return (
    <div className="mx-auto w-full max-w-5xl px-1 py-6 sm:px-6 md:px-8 md:py-10">
      <WalletNav active={location.pathname} />
      <Outlet />
    </div>
  );
}

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ConfirmModal } from "../components/ui/ConfirmModal.js";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * A promise-based, app-wide replacement for `window.confirm(...)` — styled
 * consistently with the rest of the ui kit instead of the browser's native
 * (and completely unstyleable) confirm dialog, but with the exact same
 * call-site ergonomics. Mount once near the app root (see App.tsx); call
 * `useConfirm()` anywhere below it:
 *
 *   const confirm = useConfirm();
 *   async function handleResign() {
 *     if (await confirm({ title: "Resign this game?", variant: "danger" })) {
 *       socket.emit("game:resign", { gameId });
 *     }
 *   }
 *
 * Only one confirmation can be pending at a time — a second `confirm()`
 * call while one is already open replaces it (matching how a second
 * `window.confirm()` would've blocked the first anyway).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function settle(result: boolean) {
    pending?.resolve(result);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmModal
        open={!!pending}
        onClose={() => settle(false)}
        onConfirm={() => settle(true)}
        title={pending?.title ?? ""}
        description={pending?.description}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        variant={pending?.variant}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

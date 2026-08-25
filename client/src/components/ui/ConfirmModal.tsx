import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal.js";
import { Button } from "./Button.js";

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` gets a warning icon and a red confirm button, for anything
   *  irreversible (resigning, cancelling, withdrawing). */
  variant?: "default" | "danger";
  /** Shows a spinner on the confirm button and disables both buttons, for
   *  an onConfirm that kicks off an async action itself rather than firing
   *  a fire-and-forget socket event. */
  loading?: boolean;
}

/** The one confirmation-dialog component for the app, styled consistently
 *  instead of the browser's unstyleable native confirm(). Most call sites
 *  won't use this directly though; reach for useConfirm() (see
 *  contexts/ConfirmContext.tsx) for the ergonomic promise-based API this
 *  renders under the hood. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} className="max-w-sm">
      <div className="flex items-start gap-3">
        {variant === "danger" && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500">
            <AlertTriangle className="h-5 w-5" />
          </span>
        )}
        <div>
          <h2 className="text-base font-semibold text-base-content">{title}</h2>
          {description && <p className="mt-1 text-sm text-base-content/60">{description}</p>}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant={variant === "danger" ? "danger" : "primary"} size="sm" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

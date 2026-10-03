import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftCircle,
  Loader2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Settings,
  Share2,
} from "lucide-react";
import { Button, Dropdown, Input, Modal } from "../ui/index.js";
import type { DropdownItem } from "../ui/index.js";

/** The one big state-dependent button on the tournament dock. Play and Pause
 *  double as "in / out" for a tournament that hasn't started: Play joins,
 *  Pause leaves. Once it's running (arena / swiss) the same two icons are
 *  the real pause / resume. */
export interface TournamentPrimaryAction {
  icon: "play" | "pause";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** True from the click until the server's answer lands: the icon becomes
   *  a spinner and the button ignores taps. */
  loading?: boolean;
}

/** Phone-only action dock for the tournament page. Same `.docker game` shell
 *  as the in-game bar (GameActionBarMobile) and it takes over the same fixed
 *  bottom slot, MobileDock hides itself on this route (see Sidebar.tsx).
 *
 *  Slots, left to right: back, chat (when the organizer enabled it),
 *  share, settings (a dropup with the organizer's edit / cancel, only
 *  shown when there is something in it), and play/pause on the extreme
 *  right (when there is something to play or pause). */
export function TournamentActionBarMobile({
  primary,
  onChat,
  onShare,
  chatDot,
  menuItems,
  backTo = "/tournaments",
}: {
  primary: TournamentPrimaryAction | null;
  onChat: (() => void) | null;
  onShare: (() => void) | null;
  chatDot: boolean;
  menuItems: DropdownItem[];
  backTo?: string;
}) {
  const navigate = useNavigate();

  function handleBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1);
    else navigate(backTo);
  }

  const PrimaryIcon = primary?.icon === "pause" ? Pause : Play;

  // Portaled to <body>: the page shell animates with a transform, and a
  // fixed element inside a transformed ancestor is positioned against that
  // ancestor instead of the screen.
  return createPortal(
    <nav aria-label="Tournament actions" className="docker game flex md:hidden">
      <button
        type="button"
        aria-label="Back"
        className="docker-item docker-item-grow"
        onClick={handleBack}
      >
        <ArrowLeftCircle className="h-5 w-5 text-primary" />
      </button>

      {onChat && (
        <button
          type="button"
          aria-label="Chat"
          className="docker-item docker-item-grow relative"
          onClick={onChat}
        >
          <MessageSquare className="h-5 w-5" />
          {chatDot && (
            <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-base-100" />
          )}
        </button>
      )}

      {onShare && (
        <button
          type="button"
          aria-label="Share tournament"
          className="docker-item docker-item-grow"
          onClick={onShare}
        >
          <Share2 className="h-5 w-5" />
        </button>
      )}

      {menuItems.length > 0 && (
        <Dropdown
          trigger={
            <button
              type="button"
              aria-label="Tournament settings"
              className="docker-item w-full docker-item-grow"
            >
              <Settings className="h-5 w-5" />
            </button>
          }
          items={menuItems}
          align="end"
          side="top"
        />
      )}

      {primary && (
        <button
          type="button"
          aria-label={primary.label}
          disabled={primary.disabled || primary.loading}
          aria-busy={primary.loading || undefined}
          className="docker-item docker-item-grow"
          onClick={primary.onClick}
        >
          {primary.loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <PrimaryIcon className="h-5 w-5" />
          )}
        </button>
      )}
    </nav>,
    document.body,
  );
}

/** Asks for the tournament password before joining one that has it. Shown
 *  for both phone and desktop, so the password is never typed into the page
 *  itself. `error` is the server's reason for a rejected attempt (wrong
 *  password, already in a game, ...), kept inside the modal so it isn't
 *  hidden behind the backdrop. */
export function JoinPasswordModal({
  open,
  tournamentName,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  tournamentName: string;
  error: string;
  onSubmit: (password: string) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh field every time it opens, and focus it so the keyboard comes up.
  useEffect(() => {
    if (!open) return;
    setPassword("");
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  function submit() {
    if (!password.trim()) return;
    onSubmit(password);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Password required"
      icon={<Lock className="h-4 w-4" />}
    >
      <div className="space-y-3 px-2 pb-1">
        <p className="text-sm text-base-content/60">
          Enter the password to join{" "}
          <span className="font-semibold text-base-content">
            {tournamentName}
          </span>
          .
        </p>
        <Input
          ref={inputRef}
          type="password"
          placeholder="Tournament password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoComplete="off"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="glass" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!password.trim()}
            onClick={submit}
          >
            Join
          </Button>
        </div>
      </div>
    </Modal>
  );
}

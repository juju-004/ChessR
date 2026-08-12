import { type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { Button } from "../ui/index.js";
import { springSnappy } from "../../lib/motion.js";

interface ChatMessage {
  username: string;
  message: string;
  at: number;
}

interface GameChatPanelProps {
  show: boolean;
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSend: (e: FormEvent) => void;
}

/** Spectator chat — a bottom sheet on phone, a right-side drawer from md
 *  up. Both variants share one backdrop and one open/close state; only one
 *  of the two panel variants is ever visible at a given breakpoint (the
 *  other stays mounted but hidden via Tailwind's responsive display
 *  classes), so there's no per-breakpoint branching in JS — just CSS
 *  deciding which one shows. */
export function GameChatPanel({
  show,
  open,
  onClose,
  messages,
  chatInput,
  onChatInputChange,
  onSend,
}: GameChatPanelProps) {
  const header = (
    <>
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-base-content">
          <MessageSquare className="h-4 w-4" /> Spectator chat
        </h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-base-content/50 hover:text-base-content/80"
        >
          ✕
        </button>
      </div>
      <p className="mb-2 shrink-0 text-xs text-base-content/50">
        Only visible to spectators, not the players. Not saved — refreshing
        clears it.
      </p>
    </>
  );

  const body = (
    <>
      <div className="mb-2 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl bg-base-100/60 p-2.5 text-sm">
        {messages.length === 0 && (
          <p className="text-base-content/50">No messages yet.</p>
        )}
        {messages.map((m, i) => (
          <p key={i}>
            <span className="font-semibold text-(--primary)">
              {m.username}:
            </span>{" "}
            <span className="text-base-content">{m.message}</span>
          </p>
        ))}
      </div>
      <form onSubmit={onSend} className="flex shrink-0 gap-2">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => onChatInputChange(e.target.value)}
          maxLength={300}
          placeholder="Say something…"
          className="h-10 flex-1 rounded-lg border border-base-300 bg-base-200 px-3 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-(--primary)"
        />
        <Button type="submit" size="md">
          Send
        </Button>
      </form>
    </>
  );

  return (
    <AnimatePresence>
      {show && open && (
        <motion.div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Bottom sheet — phone only. */}
          <motion.div
            className="elevated-strong absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col rounded-t-2xl p-4 md:hidden"
            style={{
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springSnappy}
          >
            {header}
            {body}
          </motion.div>

          {/* Right-side drawer — tablet & desktop. */}
          <motion.div
            className="elevated-strong absolute inset-y-0 right-0 hidden w-full max-w-sm flex-col p-4 md:flex"
            style={{
              paddingTop: "calc(1rem + env(safe-area-inset-top))",
            }}
            onClick={(e) => e.stopPropagation()}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={springSnappy}
          >
            {header}
            {body}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

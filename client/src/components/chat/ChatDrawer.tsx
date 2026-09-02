import { memo, useRef, useState, type FormEvent } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { CornerUpLeft, MessageSquare, Send, X } from "lucide-react";
import { Avatar, Button } from "../ui/index.js";
import { overlayIn, overlayOut } from "../../lib/motion.js";
import type { ChatMessage } from "../../lib/chatTypes.js";
import { cn } from "@/lib/cn.js";

interface ChatDrawerProps {
  show: boolean;
  open: boolean;
  onClose: () => void;
  title: string;
  /** Shown once under the title, e.g. what's persisted/who can see it. */
  notice?: string;
  messages: ChatMessage[];
  myUsername?: string | null;
  onSend: (message: string, replyToId?: string) => void;
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

const SWIPE_REPLY_THRESHOLD = 56;

/** One message bubble. Swipe right (WhatsApp convention, works the same
 *  regardless of which side the bubble is aligned to) to reply, drag
 *  progress is tracked with a motion value rather than React state so
 *  dragging never triggers a re-render, only the eventual onDragEnd past
 *  the threshold does anything. */
const ChatBubble = memo(function ChatBubble({
  message,
  isMine,
  showMeta,
  onReply,
}: {
  message: ChatMessage;
  isMine: boolean;
  showMeta: boolean;
  onReply: (message: ChatMessage) => void;
}) {
  const x = useMotionValue(0);
  const replyIconOpacity = useTransform(x, [0, SWIPE_REPLY_THRESHOLD], [0, 1]);

  return (
    <div className="relative">
      <motion.div
        aria-hidden
        style={{ opacity: replyIconOpacity }}
        className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-base-content/40"
      >
        <CornerUpLeft className="h-4 w-4" />
      </motion.div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 80 }}
        dragElastic={0.35}
        dragMomentum={false}
        dragSnapToOrigin
        style={{ x }}
        onDragEnd={(_, info) => {
          if (info.offset.x > SWIPE_REPLY_THRESHOLD) onReply(message);
        }}
        className={`flex items-end gap-2 ${isMine ? "flex-row-reverse" : ""}`}
      >
        <div className="w-6 shrink-0">
          {showMeta && !isMine && (
            <Avatar
              username={message.username}
              gradient={message.avatarGradient}
              size="xs"
            />
          )}
        </div>
        <div
          className={`flex max-w-[75%] flex-col ${isMine ? "items-end" : "items-start"}`}
        >
          {showMeta && (
            <span
              className={`mb-0.5 px-1 text-[11px] font-medium text-base-content/45 ${isMine ? "text-right" : ""}`}
            >
              {isMine ? "You" : message.username} · {timeOf(message.at)}
            </span>
          )}
          <div
            className={`rounded-2xl px-3 py-1.5 text-sm wrap-break-word ${
              isMine
                ? "gradient-brand rounded-br-sm text-white"
                : "rounded-bl-sm bg-base-300/70 text-base-content"
            }`}
          >
            {message.replyTo && (
              <div
                className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-xs ${
                  isMine
                    ? "border-white/50 bg-white/10 text-white/80"
                    : "border-(--primary)/50 bg-base-100/40 text-base-content/60"
                }`}
              >
                <div className="text-[10px] font-medium opacity-80">
                  {message.replyTo.username}
                </div>
                <div className="truncate text-xs">
                  {message.replyTo.message}
                </div>
              </div>
            )}
            {message.message}
          </div>
        </div>
      </motion.div>
    </div>
  );
});

/** The scrollable log. Memoized and kept isolated from the composer's
 *  input state (see ChatComposer below): the old version lifted chat
 *  input into the parent page's state, which meant every keystroke
 *  re-rendered the entire message list (and, on the game page, the whole
 *  page re-renders once a second anyway for the clock, which made an
 *  unmemoized panel (box-shadow and all, see ChatDrawer's panel divs
 *  below) redo that work every tick too).
 *  Splitting things this way means typing, and the clock ticking, no
 *  longer touch this at all, only a genuinely new message does. */
const MessageList = memo(function MessageList({
  messages,
  myUsername,
  onReply,
  isModal,
}: {
  isModal?: boolean;
  messages: ChatMessage[];
  myUsername?: string | null;
  onReply: (message: ChatMessage) => void;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex flex-1 flex-col gap-1.5 overflow-y-auto rounded-xl bg-base-100/60 p-2.5 ",
        isModal ? "min-h-[40vh]" : "min-h-0",
      )}
    >
      {messages.length === 0 && (
        <p className="text-sm text-base-content/50">No messages yet.</p>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const showMeta =
          !prev || prev.username !== m.username || m.at - prev.at > 5 * 60_000;
        return (
          <ChatBubble
            key={m.id}
            message={m}
            isMine={!!myUsername && m.username === myUsername}
            showMeta={showMeta}
            onReply={onReply}
          />
        );
      })}
    </div>
  );
});

/** Input row, its own component so keystrokes only ever re-render this,
 *  never the message list or the panel chrome around it. */
const ChatComposer = memo(function ChatComposer({
  replyingTo,
  onCancelReply,
  onSend,
}: {
  replyingTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (message: string, replyToId?: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed, replyingTo?.id);
    setValue("");
  }

  return (
    <div className="shrink-0">
      {replyingTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-base-100/70 px-2.5 py-1.5 text-xs">
          <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-base-content/40" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium text-base-content/70">
              {replyingTo.username}
            </div>
            <div className="truncate text-xs text-base-content/50">
              {replyingTo.message}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="shrink-0 text-base-content/40 hover:text-base-content/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <form onSubmit={submit} className="flex w-full min-w-0 gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={300}
          placeholder="Say something…"
          className="h-10 min-w-0 flex-1 rounded-lg border border-base-300 bg-base-200 px-3 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-(--primary)"
        />
        <Button type="submit" size="md" aria-label="Send" className="shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
});

/** Bottom sheet on phone, right-side drawer from md up. Both variants
 *  share one backdrop and one open/close state; only one panel variant is
 *  ever visible at a given breakpoint (the other stays mounted but hidden
 *  via Tailwind's responsive display classes). */
function ChatDrawerImpl({
  show,
  open,
  onClose,
  title,
  notice,
  messages,
  myUsername,
  onSend,
}: ChatDrawerProps) {
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  function handleSend(message: string, replyToId?: string) {
    onSend(message, replyToId);
    setReplyingTo(null);
  }

  const header = (
    <>
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-base-content">
          <MessageSquare className="h-4 w-4" /> {title}
        </h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-base-content/50 hover:text-base-content/80"
        >
          ✕
        </button>
      </div>
      <p className="mb-2 shrink-0 text-xs text-base-content/50">{notice}</p>
    </>
  );

  const body = (
    <>
      <MessageList
        isModal
        messages={messages}
        myUsername={myUsername}
        onReply={setReplyingTo}
      />
      <ChatComposer
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSend={handleSend}
      />
    </>
  );

  return (
    <AnimatePresence>
      {show && open && (
        <motion.div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: overlayIn }}
          exit={{ opacity: 0, transition: overlayOut }}
        >
          {/* Bottom sheet, phone only. elevated-flat, not elevated-strong:
              no box-shadow at all here (this panel repaints on every
              swipe-to-reply drag frame in the messages behind it, so it's
              worth being the one surface with zero shadow cost, not just
              a cheaper one). The dark backdrop behind it (bg-black/60,
              just above) is what separates it from the page, not a
              shadow. */}
          <motion.div
            className="elevated-flat absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-base-300/60 p-4 md:hidden"
            style={{
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0, transition: overlayIn }}
            exit={{ y: "100%", transition: overlayOut }}
          >
            {header}
            {body}
          </motion.div>

          {/* Right-side drawer, tablet & desktop. Same reasoning as the
              phone sheet above: elevated-flat + a plain border, no
              box-shadow. */}
          <motion.div
            className="elevated-flat absolute inset-y-0 right-0 hidden w-full max-w-sm flex-col border-l border-base-300/60 p-4 md:flex"
            style={{
              paddingTop: "calc(1rem + env(safe-area-inset-top))",
            }}
            onClick={(e) => e.stopPropagation()}
            initial={{ x: "100%" }}
            animate={{ x: 0, transition: overlayIn }}
            exit={{ x: "100%", transition: overlayOut }}
          >
            {header}
            {body}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Memoized at the top level too: while closed (show=false or open=false)
// this renders null via AnimatePresence either way, but memoizing means a
// parent re-render (e.g. Game.tsx's once-a-second clock tick) doesn't even
// re-invoke this component's body, let alone reconcile the (large, when
// open) subtree beneath it, unless messages/open/title/notice actually
// changed.
export const ChatDrawer = memo(ChatDrawerImpl);

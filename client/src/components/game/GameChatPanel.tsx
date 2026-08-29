import { ChatDrawer } from "../chat/ChatDrawer.js";
import type { ChatMessage } from "../../lib/chatTypes.js";

interface GameChatPanelProps {
  show: boolean;
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  myUsername?: string | null;
  /** Whether the game currently being viewed is a leg of a cage match, vs
   *  a standalone game, only affects the notice text (persists across
   *  legs vs. just this game). */
  isCageMatch?: boolean;
  onSend: (message: string, replyToId?: string) => void;
}

export function GameChatPanel({
  show,
  open,
  onClose,
  messages,
  myUsername,
  isCageMatch,
  onSend,
}: GameChatPanelProps) {
  return (
    <ChatDrawer
      show={show}
      open={open}
      onClose={onClose}
      title="Spectator chat"
      notice={
        isCageMatch
          ? "Only visible to spectators, not the players. Saved for the whole match, across every leg."
          : "Only visible to spectators, not the players. Saved until a bit after the game ends."
      }
      messages={messages}
      myUsername={myUsername}
      onSend={onSend}
    />
  );
}

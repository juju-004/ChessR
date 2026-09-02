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
  onSend: (message: string, replyToId?: string) => void;
}

export function GameChatPanel({
  show,
  open,
  onClose,
  messages,
  myUsername,
  onSend,
}: GameChatPanelProps) {
  return (
    <ChatDrawer
      show={show}
      open={open}
      onClose={onClose}
      title="Spectator chat"
      messages={messages}
      myUsername={myUsername}
      onSend={onSend}
    />
  );
}

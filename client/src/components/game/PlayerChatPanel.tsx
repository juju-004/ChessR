import { ChatDrawer } from "../chat/ChatDrawer.js";
import type { ChatMessage } from "../../lib/chatTypes.js";

interface PlayerChatPanelProps {
  show: boolean;
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  myUsername?: string | null;
  onSend: (message: string, replyToId?: string) => void;
}

/** The two participants' own private chat for a game (or cage match leg,
 *  which reuses the same panel across legs the same way spectator chat
 *  does). Same ChatDrawer component GameChatPanel.tsx wraps for spectator
 *  chat, just pointed at the separate player_chat socket events/scope
 *  (see gameSocket.ts's player_chat:send) so the two conversations never
 *  mix in either direction. */
export function PlayerChatPanel({
  show,
  open,
  onClose,
  messages,
  myUsername,
  onSend,
}: PlayerChatPanelProps) {
  return (
    <ChatDrawer
      show={show}
      open={open}
      onClose={onClose}
      title="Chat"
      notice="Only visible to you and your opponent."
      messages={messages}
      myUsername={myUsername}
      onSend={onSend}
    />
  );
}

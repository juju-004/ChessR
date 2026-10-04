import { memo } from "react";
import { ChatDrawer } from "../chat/ChatDrawer.js";
import { useGameChat, type GameChatStore } from "../../lib/gameChatStore.js";

interface PlayerChatPanelProps {
  show: boolean;
  store: GameChatStore;
  myUsername?: string | null;
  onSend: (message: string, replyToId?: string) => void;
}

/** The two participants' own private chat for a game (or cage match leg,
 *  which reuses the same panel across legs the same way spectator chat
 *  does). Same ChatDrawer component GameChatPanel.tsx wraps for spectator
 *  chat, just pointed at the separate player_chat socket events/scope
 *  (see gameSocket.ts's player_chat:send) so the two conversations never
 *  mix in either direction. Reads its messages/open state straight from
 *  the chat store, see GameChatPanel. */
export const PlayerChatPanel = memo(function PlayerChatPanel({
  show,
  store,
  myUsername,
  onSend,
}: PlayerChatPanelProps) {
  const open = useGameChat(store, (s) => s.player.open);
  const messages = useGameChat(store, (s) => s.player.messages);
  return (
    <ChatDrawer
      show={show}
      open={open}
      onClose={() => store.close("player")}
      title="Chat"
      notice="Only visible to you and your opponent."
      messages={messages}
      myUsername={myUsername}
      onSend={onSend}
    />
  );
});

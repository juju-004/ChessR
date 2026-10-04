import { memo } from "react";
import { ChatDrawer } from "../chat/ChatDrawer.js";
import { useGameChat, type GameChatStore } from "../../lib/gameChatStore.js";

interface GameChatPanelProps {
  show: boolean;
  /** Where messages / open state live. Subscribing here (instead of the
   *  Game page holding them in state) keeps chat traffic from re-rendering
   *  the whole page. */
  store: GameChatStore;
  myUsername?: string | null;
  onSend: (message: string, replyToId?: string) => void;
}

export const GameChatPanel = memo(function GameChatPanel({
  show,
  store,
  myUsername,
  onSend,
}: GameChatPanelProps) {
  const open = useGameChat(store, (s) => s.spectator.open);
  const messages = useGameChat(store, (s) => s.spectator.messages);
  return (
    <ChatDrawer
      show={show}
      open={open}
      onClose={() => store.close("spectator")}
      title="Spectator chat"
      messages={messages}
      myUsername={myUsername}
      onSend={onSend}
    />
  );
});

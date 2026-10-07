import { useEffect, useRef, useState } from "react";
import { useSocket } from "../../contexts/SocketContext.js";
import { ChatComposer, MessageList } from "../chat/ChatDrawer.js";
import type { ChatMessage } from "../../lib/chatTypes.js";

/** The team's chat room. Joins the team's socket room on mount (membership
 *  is verified server-side), loads the saved history, then streams new
 *  messages. Reuses the same bubbles/composer as the in-game chat drawer,
 *  swipe-to-reply included. */
export function TeamChat({ teamId, myUsername }: { teamId: string; myUsername?: string | null }) {
  const socket = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState("");
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socket) return;
    const watch = () => socket.emit("team:watch", { teamId });
    const onHistory = (p: { teamId: string; history: ChatMessage[] }) => {
      if (p.teamId === teamId) setMessages(p.history);
    };
    const onMessage = (p: ChatMessage & { teamId: string }) => {
      if (p.teamId === teamId) setMessages((prev) => [...prev.slice(-199), p]);
    };
    const onError = (p: { message: string }) => {
      setError(p.message);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setError(""), 4000);
    };
    socket.on("connect", watch);
    socket.on("team:chat_history", onHistory);
    socket.on("team:chat_message", onMessage);
    socket.on("team:error", onError);
    if (socket.connected) watch();
    return () => {
      socket.off("connect", watch);
      socket.off("team:chat_history", onHistory);
      socket.off("team:chat_message", onMessage);
      socket.off("team:error", onError);
      socket.emit("team:unwatch", { teamId });
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [socket, teamId]);

  function send(message: string, replyToId?: string) {
    socket?.emit("team:chat_send", { teamId, message, ...(replyToId ? { replyToId } : {}) });
    setReplyingTo(null);
  }

  return (
    <div className="elevated-flat flex h-[20rem] flex-col rounded-2xl p-3">
      <MessageList messages={messages} myUsername={myUsername} onReply={setReplyingTo} />
      <ChatComposer replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} onSend={send} />
      {error && <p role="alert" className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}

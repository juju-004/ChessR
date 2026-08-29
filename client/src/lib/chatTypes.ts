export interface ChatReplySnapshot {
  id: string;
  username: string;
  message: string;
}

export interface ChatMessage {
  id: string;
  username: string;
  avatarGradient?: string | null;
  message: string;
  at: number;
  replyTo?: ChatReplySnapshot | null;
}

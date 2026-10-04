import { useSyncExternalStore } from 'react';
import type { ChatMessage } from './chatTypes.js';

/**
 * Tiny external store for a game's two chat channels (spectator chat and
 * the players' private chat).
 *
 * This used to be six pieces of useState inside Game.tsx, which meant every
 * incoming chat message, and every open/close of a chat sheet, re-rendered
 * the whole game page (board, panels, move list). Living outside React
 * state, only the components that actually read a slice re-render: the chat
 * drawers (messages + open) and the action bar entries (the unread dot).
 *
 * Updates are immutable and only replace the slice that changed, so
 * selectors that return `messages` / a boolean stay referentially stable.
 */
export type ChatChannel = 'spectator' | 'player';

export interface ChatChannelState {
  messages: ChatMessage[];
  unread: boolean;
  open: boolean;
}

export interface GameChatState {
  spectator: ChatChannelState;
  player: ChatChannelState;
}

export interface GameChatStore {
  getState: () => GameChatState;
  subscribe: (listener: () => void) => () => void;
  /** Full, authoritative history load (initial join or a reconnect):
   *  replaces whatever was there instead of merging. */
  setHistory: (channel: ChatChannel, messages: ChatMessage[]) => void;
  /** A live message. `isOwn` suppresses the unread dot for the echo of the
   *  sender's own message; the dot is also skipped while the sheet's open. */
  receive: (channel: ChatChannel, message: ChatMessage, isOwn: boolean) => void;
  /** Opens the sheet and clears that channel's unread dot. */
  open: (channel: ChatChannel) => void;
  close: (channel: ChatChannel) => void;
}

const EMPTY: ChatChannelState = { messages: [], unread: false, open: false };

export function createGameChatStore(): GameChatStore {
  let state: GameChatState = { spectator: EMPTY, player: EMPTY };
  const listeners = new Set<() => void>();

  function update(channel: ChatChannel, next: ChatChannelState) {
    if (state[channel] === next) return;
    state = { ...state, [channel]: next };
    listeners.forEach((l) => l());
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setHistory(channel, messages) {
      update(channel, { ...state[channel], messages });
    },
    receive(channel, message, isOwn) {
      const cur = state[channel];
      update(channel, {
        ...cur,
        messages: [...cur.messages.slice(-199), message],
        unread: cur.unread || (!cur.open && !isOwn),
      });
    },
    open(channel) {
      const cur = state[channel];
      if (cur.open && !cur.unread) return;
      update(channel, { ...cur, open: true, unread: false });
    },
    close(channel) {
      const cur = state[channel];
      if (!cur.open) return;
      update(channel, { ...cur, open: false });
    },
  };
}

/** Subscribe to one slice of the store. The selector must return a stable
 *  value (a primitive, or an object/array that only changes identity when
 *  its contents do), which every slice above does. */
export function useGameChat<T>(
  store: GameChatStore,
  selector: (state: GameChatState) => T,
): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

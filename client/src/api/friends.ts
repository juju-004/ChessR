import { apiFetch } from './http.js';

export interface Friend {
  id: string;
  username: string;
  online: boolean;
  activeGameCode: string | null;
}

export interface IncomingRequest {
  _id: string;
  from: { _id: string; username: string };
}

export function listFriends() {
  return apiFetch<{ friends: Friend[] }>('/friends');
}

export function listIncomingRequests() {
  return apiFetch<{ requests: IncomingRequest[] }>('/friends/requests');
}

export function sendFriendRequest(toUserId: string) {
  return apiFetch<{ requestId: string; status: string }>('/friends/requests', {
    method: 'POST',
    body: JSON.stringify({ toUserId }),
  });
}

export function respondToFriendRequest(requestId: string, accept: boolean) {
  return apiFetch<{ requestId: string; status: string }>('/friends/requests/respond', {
    method: 'POST',
    body: JSON.stringify({ requestId, accept }),
  });
}

export function removeFriend(friendId: string) {
  return apiFetch<void>(`/friends/${friendId}`, { method: 'DELETE' });
}

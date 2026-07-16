import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listFriends,
  listIncomingRequests,
  respondToFriendRequest,
  type Friend,
  type IncomingRequest,
} from '../api/friends.js';
import { useSocket } from '../contexts/SocketContext.js';
import { TIME_CONTROLS } from '../timeControls.js';

export function Friends() {
  const socket = useSocket();
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [tcIndex, setTcIndex] = useState(2);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  const refreshRequests = useCallback(() => {
    listIncomingRequests().then((res) => setRequests(res.requests));
  }, []);

  const refreshFriends = useCallback(() => {
    listFriends().then((res) => setFriends(res.friends));
  }, []);

  useEffect(() => {
    refreshRequests();
    refreshFriends();
  }, [refreshRequests, refreshFriends]);

  useEffect(() => {
    if (!socket) return;

    function onRequestReceived() {
      refreshRequests();
    }
    function onPresence() {
      refreshFriends();
    }
    function onSent() {
      setStatus({ message: 'Challenge sent — waiting for a response…', isError: false });
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }

    socket.on('friend:request_received', onRequestReceived);
    socket.on('friend:presence', onPresence);
    socket.on('challenge:sent', onSent);
    socket.on('challenge:error', onError);

    return () => {
      socket.off('friend:request_received', onRequestReceived);
      socket.off('friend:presence', onPresence);
      socket.off('challenge:sent', onSent);
      socket.off('challenge:error', onError);
    };
  }, [socket, refreshFriends]);

  async function handleAccept(requestId: string) {
    await respondToFriendRequest(requestId, true);
    refreshRequests();
    refreshFriends();
  }

  async function handleDecline(requestId: string) {
    await respondToFriendRequest(requestId, false);
    refreshRequests();
  }

  function handleChallenge(friendId: string) {
    if (!socket) return;
    const tc = TIME_CONTROLS[tcIndex];
    socket.emit('challenge:send', {
      toUserId: friendId,
      baseMinutes: tc.baseMinutes,
      incrementSeconds: tc.incrementSeconds,
    });
    setStatus({ message: `Challenge sent (${tc.label}) — waiting for a response…`, isError: false });
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      {status && (
        <p className={`text-sm ${status.isError ? 'text-red-400' : 'text-green-400'}`}>{status.message}</p>
      )}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-2 text-lg font-semibold text-neutral-100">Friend requests</h1>
        {requests.length === 0 && <p className="text-sm text-neutral-400">No pending requests.</p>}
        {requests.map((r) => (
          <div key={r._id} className="flex items-center justify-between border-b border-neutral-800 py-2 last:border-none">
            <span className="text-sm text-neutral-200">
              {r.from.username} <span className="text-neutral-500">({r.from.rating})</span>
            </span>
            <span className="flex gap-2">
              <button
                onClick={() => handleAccept(r._id)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Accept
              </button>
              <button
                onClick={() => handleDecline(r._id)}
                className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
              >
                Decline
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-2 text-lg font-semibold text-neutral-100">Friends</h1>
        <label className="mb-1 block text-sm text-neutral-400">Challenge time control</label>
        <select
          value={tcIndex}
          onChange={(e) => setTcIndex(Number(e.target.value))}
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        >
          {TIME_CONTROLS.map((tc, i) => (
            <option key={tc.label} value={i}>
              {tc.label}
            </option>
          ))}
        </select>

        {friends.length === 0 && <p className="text-sm text-neutral-400">No friends yet. Find players and add some!</p>}
        {friends.map((f) => (
          <div key={f.id} className="flex items-center justify-between border-b border-neutral-800 py-2 last:border-none">
            <span className="flex items-center gap-2 text-sm text-neutral-200">
              <span className={`inline-block h-2 w-2 rounded-full ${f.online ? 'bg-green-500' : 'bg-neutral-600'}`} />
              {f.username} <span className="text-neutral-500">({f.rating})</span>
            </span>
            <span className="flex gap-2">
              <Link
                to={`/profile/${f.username}`}
                className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
              >
                Profile
              </Link>
              <button
                onClick={() => handleChallenge(f.id)}
                disabled={!f.online}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Challenge
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { searchUsers, type UserSearchResult } from '../api/users.js';

export function ProfileSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [error, setError] = useState('');

  function handleChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    searchUsers(value.trim())
      .then((res) => {
        setResults(res.users);
        setError('');
      })
      .catch(() => setError('Search failed.'));
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-3 text-xl font-bold text-neutral-100">Find players</h1>
        <input
          type="text"
          placeholder="Search by username…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        {results.length === 0 && query.trim() && !error && (
          <p className="text-sm text-neutral-400">No users found.</p>
        )}
        {results.map((u) => (
          <div key={u._id} className="flex items-center justify-between border-b border-neutral-800 py-2 last:border-none">
            <span className="text-sm text-neutral-200">{u.username}</span>
            <Link
              to={`/profile/${u.username}`}
              className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
            >
              View
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

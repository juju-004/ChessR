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
      <div className="rounded-lg border border-base-300 bg-base-200 p-5">
        <h1 className="mb-3 text-xl font-bold text-base-content">Find players</h1>
        <input
          type="text"
          placeholder="Search by username…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          className="mb-3 w-full rounded-md border border-base-300 bg-base-100 px-3 py-2 text-base-content"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        {results.length === 0 && query.trim() && !error && (
          <p className="text-sm text-base-content/60">No users found.</p>
        )}
        {results.map((u) => (
          <div key={u._id} className="flex items-center justify-between border-b border-base-300 py-2 last:border-none">
            <span className="text-sm text-base-content">{u.username}</span>
            <Link
              to={`/profile/${u.username}`}
              className="rounded-md bg-base-300 px-3 py-1.5 text-sm font-semibold text-base-content hover:bg-base-300"
            >
              View
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

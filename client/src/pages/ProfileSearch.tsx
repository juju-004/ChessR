import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { searchUsers, type UserSearchResult } from '../api/users.js';
import { Page, Card, Input, Avatar, Button } from '../components/ui/index.js';

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
    <Page title="Find players" description="Search for anyone by their username.">
      <Card variant="solid">
        <Input
          type="text"
          placeholder="Search by username…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          leadingIcon={<Search className="h-4 w-4" />}
        />

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {results.length === 0 && query.trim() && !error && (
          <p className="mt-3 text-sm text-base-content/50">No users found.</p>
        )}

        <div className="mt-3 divide-y divide-base-300">
          {results.map((u) => (
            <div key={u._id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar username={u.username} size="sm" gradient={u.avatarGradient} />
                <span className="truncate text-sm font-medium text-base-content">{u.username}</span>
              </div>
              <Link to={`/profile/${u.username}`}>
                <Button variant="glass" size="sm">
                  View
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </Card>
    </Page>
  );
}

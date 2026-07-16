import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { logout } from '../api/auth.js';

export function Navbar() {
  const { isAuthed, user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/signin');
  }

  return (
    <nav className="flex items-center gap-4 border-b border-neutral-800 bg-neutral-900 px-6 py-3">
      <span className="mr-auto font-bold text-neutral-100">♟ Chess App</span>
      {!isAuthed ? (
        <>
          <Link to="/signin" className="text-sm text-neutral-300 hover:text-neutral-100">
            Sign in
          </Link>
          <Link to="/signup" className="text-sm text-neutral-300 hover:text-neutral-100">
            Sign up
          </Link>
        </>
      ) : (
        <>
          <Link to="/dashboard" className="text-sm text-neutral-300 hover:text-neutral-100">
            Dashboard
          </Link>
          <Link to="/find" className="text-sm text-neutral-300 hover:text-neutral-100">
            Find players
          </Link>
          <Link to="/friends" className="text-sm text-neutral-300 hover:text-neutral-100">
            Friends
          </Link>
          {user && (
            <Link to={`/profile/${user.username}`} className="text-sm text-neutral-300 hover:text-neutral-100">
              My profile
            </Link>
          )}
          <span className="text-sm text-neutral-500">{user?.username}</span>
          <button onClick={handleLogout} className="text-sm text-neutral-300 hover:text-neutral-100">
            Log out
          </button>
        </>
      )}
    </nav>
  );
}

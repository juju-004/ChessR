import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="mb-2 text-3xl font-bold text-base-content">404</h1>
      <p className="mb-6 text-base-content/60">That page doesn't exist.</p>
      <Link
        to="/"
        className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
      >
        Back to dashboard
      </Link>
    </div>
  );
}

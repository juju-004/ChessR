import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signin } from "../api/auth.js";
import { ApiRequestError } from "../api/http.js";
import { Popover } from "@/components/ui/Popover.js";
import { Spinner } from "@/components/ui/Spinner.js";

export function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await signin(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Sign in failed");
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-6">
      <h1 className="mb-4 text-2xl font-bold text-neutral-100">Sign in</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-neutral-400">Email</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
          />
        </div>
        <Popover trigger={<>Time control</>}>
          {["1+0", "2+0", "3+0"].map((i, key) => (
            <span key={key}>{i}</span>
          ))}
        </Popover>
        <Spinner size="sm"></Spinner>

        <div>
          <label className="mb-1 block text-sm text-neutral-400">
            Password
          </label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
        >
          Sign in
        </button>
      </form>
      <p className="mt-3 text-sm text-neutral-400">
        No account?{" "}
        <Link to="/signup" className="text-blue-400 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}

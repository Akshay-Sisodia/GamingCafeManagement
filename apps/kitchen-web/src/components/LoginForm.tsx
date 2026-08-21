import { useState, type FormEvent } from "react";
import { ChefHat } from "lucide-react";
import { api, auth } from "../lib/api";

interface LoginResponse {
  access_token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    cafe_id: string;
  };
}

export function LoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      auth.signIn(res.access_token, res.user);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-lg"
      >
        <div className="mb-6 flex items-center gap-3">
          <ChefHat className="h-8 w-8 text-emerald-600" />
          <h1 className="text-2xl font-bold tracking-tight">Kitchen Display</h1>
        </div>
        <label className="block text-base font-medium text-zinc-700" htmlFor="kitchen-email">
          Email
        </label>
        <input
          id="kitchen-email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 h-14 w-full rounded-xl border-2 border-zinc-300 px-4 text-lg outline-none focus:border-emerald-500"
          placeholder="kitchen@cafe.in"
        />
        <label className="mt-5 block text-base font-medium text-zinc-700" htmlFor="kitchen-password">
          Password
        </label>
        <input
          id="kitchen-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 h-14 w-full rounded-xl border-2 border-zinc-300 px-4 text-lg outline-none focus:border-emerald-500"
          placeholder="••••••••"
        />
        {error ? <p className="mt-4 text-lg text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-7 min-h-16 w-full rounded-xl bg-emerald-600 text-xl font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

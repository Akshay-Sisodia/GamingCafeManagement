import { useState, type FormEvent } from "react";
import { Gamepad2 } from "lucide-react";
import { api, auth } from "../../lib/api";
import type { LoginResponse } from "../../lib/types";
import { LoginFields } from "./LoginFields";

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
      auth.signIn(res.access_token, res.user, res.refresh_token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl"
      >
        <div className="mb-6 flex items-center gap-2">
          <Gamepad2 className="h-6 w-6 text-emerald-400" />
          <h1 className="text-xl font-semibold tracking-tight">PACMAN Gaming Cafe</h1>
        </div>
        <LoginFields
          email={email}
          password={password}
          error={error}
          busy={busy}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
        />
      </form>
    </div>
  );
}

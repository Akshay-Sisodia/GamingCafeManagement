export function LoginEmailField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label className="block text-sm font-medium text-zinc-300" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        placeholder="staff@cafe.in"
      />
    </>
  );
}

export function LoginPasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label className="mt-4 block text-sm font-medium text-zinc-300" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        placeholder="••••••••"
      />
    </>
  );
}

export function LoginFields({
  email,
  password,
  error,
  busy,
  onEmailChange,
  onPasswordChange,
}: {
  email: string;
  password: string;
  error: string | null;
  busy: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
}) {
  return (
    <>
      <LoginEmailField value={email} onChange={onEmailChange} />
      <LoginPasswordField value={password} onChange={onPasswordChange} />
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </>
  );
}

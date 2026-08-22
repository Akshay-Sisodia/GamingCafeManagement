export const API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const STORAGE_PREFIX = import.meta.env.VITE_AUTH_STORAGE_PREFIX ?? "gcm";
const TOKEN_KEY = `${STORAGE_PREFIX}:access`;
const REFRESH_KEY = `${STORAGE_PREFIX}:refresh`;
const USER_KEY = `${STORAGE_PREFIX}:user`;

function storage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  cafe_id: string;
}

export const auth = {
  token(): string | null {
    try {
      return storage()?.getItem(TOKEN_KEY) ?? null;
    } catch {
      return null;
    }
  },
  refreshToken(): string | null {
    try {
      return storage()?.getItem(REFRESH_KEY) ?? null;
    } catch {
      return null;
    }
  },
  user(): AuthUser | null {
    try {
      const raw = storage()?.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },
  signIn(token: string, user: AuthUser, refreshToken?: string): void {
    const store = storage();
    if (!store) return;
    store.setItem(TOKEN_KEY, token);
    if (refreshToken) store.setItem(REFRESH_KEY, refreshToken);
    store.setItem(USER_KEY, JSON.stringify(user));
  },
  signOut(): void {
    const store = storage();
    if (!store) return;
    store.removeItem(TOKEN_KEY);
    store.removeItem(REFRESH_KEY);
    store.removeItem(USER_KEY);
  },
};

export function signOutAndRedirect(): void {
  auth.signOut();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refresh = auth.refreshToken();
  if (!refresh) return false;

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      const user = auth.user();
      if (!user) return false;
      auth.signIn(data.access_token, user, data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function execute<T>(path: string, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {};
  const token = auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API}/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { title?: string; detail?: string; code?: string };
      message = data.detail ?? data.title ?? message;
      code = data.code;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as T;
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await execute<T>(path, options);
  } catch (err) {
    const isAuthPath = path.startsWith("/auth/");
    if (err instanceof ApiError && err.status === 401 && !isAuthPath) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return await execute<T>(path, options);
      signOutAndRedirect();
    }
    throw err;
  }
}

export async function fetchSseToken(): Promise<string | null> {
  try {
    const data = await api<{ sse_token: string }>("/auth/sse-token", { method: "POST", body: {} });
    return data.sse_token;
  } catch {
    return null;
  }
}

export async function validateSession(): Promise<boolean> {
  if (!auth.token()) return false;
  try {
    await api("/me");
    return true;
  } catch {
    signOutAndRedirect();
    return false;
  }
}

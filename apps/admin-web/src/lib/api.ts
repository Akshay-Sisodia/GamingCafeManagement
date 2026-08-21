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

const TOKEN_KEY = "gc_token";
const REFRESH_KEY = "gc_refresh";
const USER_KEY = "gc_user";

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
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  refreshToken(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  user(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },
  signIn(token: string, user: AuthUser, refreshToken?: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  signOut(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

interface RequestOptions {
  method?: string;
  body?: unknown;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Exchanges the refresh token for a new access token. Returns success. */
async function refreshAccessToken(): Promise<boolean> {
  const refresh = auth.refreshToken();
  if (!refresh) return false;

  // Coalesce concurrent 401s into a single refresh call.
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
    // Access token expired → silently refresh once and retry the request.
    const isAuthPath = path.startsWith("/auth/");
    if (err instanceof ApiError && err.status === 401 && !isAuthPath) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return await execute<T>(path, options);
      auth.signOut();
    }
    throw err;
  }
}

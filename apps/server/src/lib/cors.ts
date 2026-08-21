import { config } from "../config.js";

const BASE_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
]);

/** Any Vercel preview/production domain for this project. */
function isVercelApp(origin: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin or non-browser client
  return (
    BASE_ORIGINS.has(origin) ||
    config.CORS_ORIGINS.includes(origin) ||
    isVercelApp(origin)
  );
}

/**
 * CORS headers for raw/hijacked responses — @fastify/cors never sees those,
 * so the SSE stream must inject them itself.
 */
export function corsHeadersFor(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (origin && isAllowedOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

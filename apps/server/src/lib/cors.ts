import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const BASE_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
]);

/** Vercel preview/production hostnames for web frontends. */
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

// ponytail: self-check — fails if Vercel CORS allowlist breaks
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = isAllowedOrigin("https://gaming-cafe-admin.vercel.app");
  console.assert(ok, "expected vercel.app origin to be allowed");
  console.assert(!isAllowedOrigin("https://evil.vercel.app.evil.com"), "reject lookalike host");
}

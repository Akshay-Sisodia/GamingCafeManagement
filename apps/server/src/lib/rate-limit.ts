/** ponytail: in-process rate limit — resets on restart / single instance only. */

type Bucket = { count: number; lockedUntil: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, maxAttempts = 5): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { count: 0, lockedUntil: 0 };
  if (bucket.lockedUntil > now) return false;
  buckets.set(key, bucket);
  return true;
}

export function failRateLimit(key: string, maxAttempts = 5): void {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { count: 0, lockedUntil: 0 };
  bucket.count += 1;
  bucket.lockedUntil =
    bucket.count >= maxAttempts
      ? now + Math.min(30_000 * 2 ** (bucket.count - maxAttempts), 900_000)
      : 0;
  buckets.set(key, bucket);
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

export function retryAfterSeconds(key: string): number {
  const bucket = buckets.get(key);
  if (!bucket || bucket.lockedUntil <= Date.now()) return 0;
  return Math.ceil((bucket.lockedUntil - Date.now()) / 1000);
}

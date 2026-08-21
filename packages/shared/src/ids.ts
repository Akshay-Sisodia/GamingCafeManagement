/**
 * UUIDv7 helpers — time-sortable ids that are safe to generate offline
 * on PC agents (docs/01-architecture.md ADR-10).
 *
 * Layout: 48-bit unix ms | ver(4) | 12-bit rand_a | var(2) | 62-bit rand_b
 *
 * Uses the Web Crypto global (available in Node 19+ and all browsers),
 * so this package stays runtime-agnostic.
 */

function getRandomBytes(n: number): Uint8Array {
  const g = globalThis as { crypto?: { getRandomValues(b: Uint8Array): Uint8Array } };
  if (!g.crypto) throw new Error("Web Crypto unavailable");
  return g.crypto.getRandomValues(new Uint8Array(n));
}

export function uuidv7(now: Date = new Date()): string {
  const ts = now.getTime();
  const bytes = getRandomBytes(16);

  // timestamp big-endian into first 6 bytes
  for (let i = 5; i >= 0; i--) {
    bytes[i] = (ts >>> ((5 - i) * 8)) & 0xff;
  }

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // RFC 9562 variant

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Extract the unix-ms timestamp embedded in a UUIDv7. Returns null for other versions. */
export function uuidv7Timestamp(id: string): number | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    return null;
  }
  let ts = 0;
  for (const byteHex of id.replace(/-/g, "").slice(0, 12).match(/.{2}/g) ?? []) {
    ts = ts * 256 + parseInt(byteHex, 16);
  }
  return ts;
}

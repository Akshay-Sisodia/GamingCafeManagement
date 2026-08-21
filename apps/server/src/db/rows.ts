/** Normalize drizzle `execute()` / driver result shapes into a row array. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: T[] };
  return maybe.rows ?? [];
}

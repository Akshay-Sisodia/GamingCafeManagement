import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const pool = postgres(config.DATABASE_URL, { max: 10 });
export const db = drizzle(pool, { schema });

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export async function closeDb(): Promise<void> {
  await pool.end();
}

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Tech spec §16.3 item 2: every query goes through this module, so moving to
 * RDS Proxy is a connection-string change. One pool per process.
 */
const g = globalThis as unknown as { __qaSql?: postgres.Sql; __qaDb?: Db };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

export function getDb(): Db {
  if (!g.__qaDb) {
    g.__qaSql = postgres(databaseUrl(), {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
    });
    g.__qaDb = drizzle(g.__qaSql, { schema });
  }
  return g.__qaDb;
}

export async function closeDb(): Promise<void> {
  await g.__qaSql?.end({ timeout: 5 });
  g.__qaSql = undefined;
  g.__qaDb = undefined;
}

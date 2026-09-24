import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { getDb, schema as s } from "@qa/db";
import { seedContent } from "@qa/db/seed";
import { invalidateContent } from "../src";

export async function resetDatabase() {
  const db = getDb();
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
  await seedContent(process.env.CONTENT_BUNDLE!, () => {});
  invalidateContent();
}

export async function makeUser(email = `u${Math.random().toString(36).slice(2, 8)}@example.com`, archetypeId = "puzzle-trading") {
  const [u] = await getDb().insert(s.users).values({ email, archetypeId, onboarding: "done", ageConfirmedAt: new Date() }).returning();
  return u!;
}

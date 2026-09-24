import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./client";

// Forward-only, run as a separate step before the application rolls (tech spec §17).
const folder = fileURLToPath(new URL("../migrations", import.meta.url));
await migrate(getDb(), { migrationsFolder: folder });
console.log("migrations applied");
await closeDb();

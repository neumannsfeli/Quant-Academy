import { and, eq } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { AppError } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api<{ id: string }>(async (_req, { user, params }) => {
  const [row] = await getDb().select().from(s.sessions).where(and(eq(s.sessions.id, params.id), eq(s.sessions.userId, user.id)));
  if (!row) throw new AppError("NOT_FOUND", "session");
  return { id: row.id, mode: row.mode, startedAt: row.startedAt, endedAt: row.endedAt, summary: row.summary };
});

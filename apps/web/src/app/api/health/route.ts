import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@qa/db";

export const dynamic = "force-dynamic";

/** Liveness for the deploy script and the reverse proxy: the process answers and Postgres does too. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

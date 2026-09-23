import { NextResponse } from "next/server";
import { FileMailer } from "@qa/core";

/** Local development only: the file mailer's outbox, so a magic link can be clicked without SES. */
export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.DEV_MAILBOX !== "on") return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  return NextResponse.json(new FileMailer().list().slice(0, 50));
}

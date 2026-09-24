import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getDb, schema as s } from "@qa/db";
import { AppError, rateLimit, requireRole, type Role } from "@qa/core";
import { auth } from "@/auth";

export type CurrentUser = typeof s.users.$inferSelect;

export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [u] = await getDb().select().from(s.users).where(eq(s.users.id, id));
  return u && !u.deletedAt ? u : null;
}

/** Pages: signed in, and through onboarding unless `allowOnboarding`. */
export async function requireUser(opts: { allowOnboarding?: boolean } = {}): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/signup");
  if (!opts.allowOnboarding && u.onboarding !== "done") redirect(u.onboarding === "placement" ? "/placement" : "/onboarding");
  return u;
}

export async function requireStaff(roles: Role[] = ["author", "reviewer", "admin"]): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/signup");
  if (!roles.includes(u.role as Role)) redirect("/home");
  return u;
}

type Ctx<P> = { params: Promise<P> };

/**
 * Route handler wrapper: resolves the user server-side (no handler accepts a user id
 * from the client — tech spec §10) and maps errors to the one error shape.
 */
export function api<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: { user: CurrentUser; params: P }) => Promise<unknown>,
  opts: { roles?: Role[]; public?: false } = {},
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const user = await currentUser();
      if (!user) throw new AppError("UNAUTHENTICATED");
      if (opts.roles) {
        requireRole(user.role, opts.roles);
        if (req.method !== "GET") await rateLimit("admin", user.id);
      }
      const out = await handler(req, { user, params: await ctx.params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function publicApi<P = Record<string, string>>(handler: (req: NextRequest, ctx: { params: P }) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const out = await handler(req, { params: await ctx.params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json(e.toJSON(), { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION", message: e.issues[0]?.message ?? "invalid", field: e.issues[0]?.path.join(".") } }, { status: 400 });
  console.error(e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "something went wrong" } }, { status: 500 });
}

export async function body<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError("VALIDATION", "expected a JSON body");
  }
}

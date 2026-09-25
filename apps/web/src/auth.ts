import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { events, rateLimit, sendMail, templates } from "@qa/core";

/**
 * Tech spec §10 — passwordless: a magic link (15 minutes, single use, stored
 * hashed by Auth.js) or Google. Sessions are database-backed so they can be revoked.
 */
const providers: NextAuthConfig["providers"] = [
  {
    id: "email",
    type: "email",
    name: "Email",
    maxAge: 15 * 60,
    from: process.env.MAIL_FROM ?? "hello@quantacademy.local",
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      const email = identifier.toLowerCase();
      await rateLimit("auth", email);
      const [existing] = await getDb().select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
      await sendMail(email, templates.signIn(url, !existing));
      await events.emit(existing ? "signin_requested" : "signup_started", existing?.id ?? null, { method: "email" });
    },
  },
];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: s.users,
    accountsTable: s.accounts,
    sessionsTable: s.authSessions,
    verificationTokensTable: s.verificationTokens,
  } as never),
  session: { strategy: "database", maxAge: 30 * 24 * 3600 },
  providers,
  trustHost: true,
  pages: { signIn: "/signup", verifyRequest: "/check-email", error: "/signup" },
  events: {
    async createUser({ user }) {
      await events.emit("signup_completed", user.id ?? null, { method: "email" });
    },
  },
  callbacks: {
    // With database sessions the default payload carries the session token and the whole
    // user row; /api/auth/session is readable by page scripts, so send only what a page needs.
    session({ session, user }) {
      return { expires: session.expires, user: { id: user.id, email: user.email, name: user.name ?? null, image: user.image ?? null } } as typeof session;
    },
  },
});

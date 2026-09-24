import Link from "next/link";
import { Logo, btnClass } from "@/components/ui";
import { ResendLink } from "@/components/resend";

export const metadata = { title: "Check your inbox" };

/** Frame 21 · Check your email. */
export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  const gmail = email?.endsWith("@gmail.com") || email?.endsWith("@googlemail.com");
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-[440px] bg-surface border border-line-strong rounded-[14px] p-7 flex flex-col items-center gap-4 text-center">
        <Logo />
        <h1 className="text-[22px] font-semibold">Check your inbox</h1>
        <p className="text-[13px] leading-[20px] text-ink-2">We sent a sign-in link to {email ?? "your email"}. It works once and expires in 15 minutes.</p>
        {gmail ? <a href="https://mail.google.com" className={btnClass("secondary", "md", "w-full")}>Open Gmail</a> : null}
        {email ? <ResendLink email={email} /> : null}
        {process.env.NODE_ENV !== "production" ? (
          <Link href="/dev/mailbox" className="font-mono text-[11px] text-blue underline">Development: open the local mailbox</Link>
        ) : null}
        <div className="w-full h-px bg-line" />
        <p className="text-[11px] leading-[17px] text-ink-3">Nothing arrived? Check spam, or use a different address — some university email systems delay external mail by several minutes.</p>
        <Link href="/signup" className="text-[12px] text-ink-2 hover:text-ink">← Use a different email</Link>
      </div>
    </div>
  );
}

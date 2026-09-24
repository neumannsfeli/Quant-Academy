import Link from "next/link";
import { Logo, btnClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo size={36} />
      <p className="label">404</p>
      <h1 className="text-[22px] font-semibold">Nothing lives at this address</h1>
      <p className="text-[13px] text-ink-2 max-w-[380px]">The link may be old, or the skill may have been renamed. Your progress is safe.</p>
      <Link href="/home" className={btnClass("primary")}>Go to Home</Link>
    </main>
  );
}

import Link from "next/link";
import { Logo, btnClass, focusRing } from "./ui";

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="h-[60px] border-b border-line flex items-center justify-between px-10 max-[700px]:px-4">
      <Link href="/" className={`flex items-center gap-[10px] rounded ${focusRing}`}>
        <Logo />
        <span className="text-[13.5px] font-semibold">Quant Academy</span>
      </Link>
      <nav className="flex items-center gap-7 text-[12px] text-ink-2" aria-label="Site">
        <Link href="/#how" className="hover:text-ink max-[700px]:hidden">How it works</Link>
        <Link href="/#skills" className="hover:text-ink max-[700px]:hidden">Skills</Link>
        <Link href="/how-scoring-works" className="hover:text-ink max-[700px]:hidden">How scoring works</Link>
        {signedIn ? (
          <Link href="/home" className={btnClass("primary", "sm")}>Open the app</Link>
        ) : (
          <>
            <Link href="/signup?mode=signin" className="hover:text-ink">Sign in</Link>
            <Link href="/signup" className={btnClass("primary", "sm", "max-[700px]:hidden")}>Start free</Link>
          </>
        )}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface px-10 max-[700px]:px-4 py-6 flex items-center justify-between flex-wrap gap-4 text-[11px] text-ink-3">
      <span>© {new Date().getFullYear()} Quant Academy</span>
      <nav className="flex gap-6 flex-wrap" aria-label="Footer">
        <Link href="/how-scoring-works" className="hover:text-ink">How scoring works</Link>
        <Link href="/legal/content" className="hover:text-ink">Content &amp; sources</Link>
        <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
        <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
        <a href="mailto:hello@quant-academy.example" className="hover:text-ink">Contact</a>
      </nav>
    </footer>
  );
}

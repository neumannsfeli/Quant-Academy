import Link from "next/link";
import { signOut } from "@/auth";
import { Logo, focusRing } from "./ui";
import { NavLinks } from "./nav";

export function TopBar({ archetypeName, email, staff }: { archetypeName: string | null; email: string; staff?: boolean }) {
  return (
    <header className="h-14 bg-surface border-b border-line flex items-center justify-between px-7 no-print">
      <div className="flex items-center gap-[10px]">
        <Link href="/home" className={`flex items-center gap-[10px] rounded ${focusRing}`}>
          <Logo />
          <span className="text-[13.5px] font-semibold">Quant Academy</span>
        </Link>
        <NavLinks />
        {staff ? (
          <Link href="/admin" className={`ml-4 text-[12px] text-red hover:text-ink rounded ${focusRing}`}>
            Admin
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-[10px]">
        {archetypeName ? (
          <Link href="/settings#profile" className={`flex items-center gap-2 bg-elevated border border-line rounded-[7px] px-[11px] py-[6px] ${focusRing}`}>
            <span className="font-mono text-[8.5px] tracking-[0.12em] text-ink-3">PROFILE</span>
            <span className="text-[11px] font-medium text-ink">{archetypeName} ▾</span>
          </Link>
        ) : null}
        <details className="relative">
          <summary className={`list-none cursor-pointer size-[26px] rounded-full bg-line-strong flex items-center justify-center text-[11px] font-semibold text-ink-2 ${focusRing}`} aria-label="Account menu">
            {email.slice(0, 1).toUpperCase()}
          </summary>
          <div className="absolute right-0 mt-2 w-56 bg-elevated border border-line-strong rounded-[8px] p-2 z-50 text-[12px] shadow-xl">
            <p className="px-2 py-1.5 text-ink-3 truncate">{email}</p>
            <Link href="/settings" className="block px-2 py-1.5 rounded hover:bg-surface">Settings</Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="w-full text-left px-2 py-1.5 rounded hover:bg-surface text-ink-2">Sign out</button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}

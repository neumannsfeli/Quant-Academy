"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusRing } from "../ui";

export function AdminNav({ review, flags, who }: { review: number; flags: number; who: string }) {
  const path = usePathname();
  const items = [
    { href: "/admin/templates", label: "Templates" },
    { href: "/admin/lessons", label: "Lessons" },
    { href: "/admin/review", label: "Review queue", badge: review, tone: "bg-blue/20 text-blue" },
    { href: "/admin/flags", label: "Flags", badge: flags, tone: "bg-red/20 text-red" },
    { href: "/admin/health", label: "Item health" },
  ];
  return (
    <header className="h-[50px] bg-surface border-b border-line flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <Link href="/home" className={`flex items-center gap-2 rounded ${focusRing}`}>
          <span className="text-[13px] font-semibold">Quant Academy</span>
          <span className="font-mono text-[8.5px] tracking-[0.12em] text-working bg-working/15 rounded px-[6px] py-[3px]">ADMIN</span>
        </Link>
        <nav className="flex items-center gap-6 text-[12.5px]" aria-label="Admin">
          {items.map((i) => {
            const active = path.startsWith(i.href);
            return (
              <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={`flex items-center gap-2 rounded ${focusRing} ${active ? "text-ink font-medium" : "text-ink-2 hover:text-ink"}`}>
                {i.label}
                {i.badge ? <span className={`font-mono text-[9.5px] rounded px-[6px] py-[2px] ${i.tone}`}>{i.badge}</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>
      <span className="font-mono text-[10px] text-ink-3">{who}</span>
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const t: Record<string, string> = {
    live: "bg-ready/15 text-ready",
    in_review: "bg-blue/15 text-blue",
    draft: "bg-elevated text-ink-3",
    retired: "bg-red/15 text-red",
  };
  return <span className={`inline-block font-mono text-[8.5px] tracking-[0.12em] uppercase rounded px-[6px] py-[3px] ${t[status] ?? t.draft}`}>{status.replace("_", " ")}</span>;
}

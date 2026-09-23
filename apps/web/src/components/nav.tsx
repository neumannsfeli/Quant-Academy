"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusRing } from "./ui";

const ITEMS = [
  { href: "/home", label: "Home" },
  { href: "/learn", label: "Learn" },
  { href: "/progress", label: "Progress" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-[26px] pl-4 text-[12px]" aria-label="Main">
      {ITEMS.map((i) => {
        const active = path === i.href || path.startsWith(`${i.href}/`) || (i.href === "/learn" && path.startsWith("/skills"));
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={`${focusRing} rounded ${active ? "text-ink font-medium" : "text-ink-2 hover:text-ink"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

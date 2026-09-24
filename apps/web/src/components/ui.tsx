import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Frame 17 · Interaction states. Primary, secondary and ghost buttons with hover,
 * focus (3px blue at 55%), active, loading and disabled; the answer input.
 */
const BTN = {
  primary:
    "bg-blue text-canvas font-medium hover:bg-[#7da4ff] active:bg-[#4a78e0] disabled:bg-[#1f2d4d] disabled:text-[#3b4a6b]",
  secondary:
    "bg-elevated text-ink-2 border border-line-strong font-medium hover:text-ink hover:border-[#4a5670] active:bg-[#151b24] disabled:text-ink-3 disabled:border-line",
  ghost: "text-ink-2 border border-line font-medium hover:bg-elevated hover:text-ink active:bg-inset disabled:text-ink-3",
  danger: "bg-red/90 text-canvas font-medium hover:bg-red disabled:opacity-40",
} as const;

export const focusRing = "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/55";

export function btnClass(kind: keyof typeof BTN = "primary", size: "sm" | "md" | "lg" = "md", extra = "") {
  const sz = size === "sm" ? "px-3.5 py-2 text-[12px] rounded-[7px]" : size === "lg" ? "px-6 py-3 text-[13px] rounded-[8px]" : "px-[22px] py-[11px] text-[12.5px] rounded-[8px]";
  return `inline-flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed ${focusRing} ${BTN[kind]} ${sz} ${extra}`;
}

export function Button({ kind = "primary", size = "md", loading, children, className = "", ...rest }: ComponentProps<"button"> & { kind?: keyof typeof BTN; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={btnClass(kind, size, className)}>
      {loading ? "Working…" : children}
    </button>
  );
}

export function ButtonLink({ kind = "primary", size = "md", className = "", ...rest }: ComponentProps<typeof Link> & { kind?: keyof typeof BTN; size?: "sm" | "md" | "lg" }) {
  return <Link {...rest} className={btnClass(kind, size, className)} />;
}

export function Card({ className = "", children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} className={`bg-surface border border-line rounded-[10px] ${className}`}>
      {children}
    </div>
  );
}

export function Label({ children, className = "", color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <p className={`label ${className}`} style={color ? { color } : undefined}>
      {children}
    </p>
  );
}

export function Chip({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red"; className?: string }) {
  const t = {
    neutral: "border-line-strong text-ink-2",
    blue: "border-blue/60 text-blue bg-blue/10",
    green: "border-ready/50 text-ready bg-ready/10",
    amber: "border-working/60 text-working bg-working/10",
    red: "border-red/60 text-red bg-red/10",
  }[tone];
  return <span className={`inline-flex items-center font-mono text-[9.5px] tracking-[0.12em] uppercase border rounded-[5px] px-2 py-[5px] ${t} ${className}`}>{children}</span>;
}

/** Three-segment level meter used on skill rows. */
export function Meter({ level, locked }: { level: number; locked?: boolean }) {
  const color = locked ? "bg-[rgba(44,52,66,0.7)]" : level >= 3 ? "bg-ready" : level === 2 ? "bg-working" : level === 1 ? "bg-familiar" : "bg-line";
  return (
    <span className="inline-flex gap-[2px]" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1 w-[13px] rounded-[2px] ${locked ? color : i <= Math.max(level, 0) ? color : "bg-line"}`} />
      ))}
    </span>
  );
}

export function Bar({ value, max = 100, color, height = 6, className = "", marker }: { value: number; max?: number; color: string; height?: number; className?: string; marker?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`relative bg-line rounded-full overflow-hidden ${className}`} style={{ height }} role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      {marker !== undefined ? <div className="absolute top-[-3px] w-[2px] bg-ink-3" style={{ left: `${(marker / max) * 100}%`, height: height + 6 }} /> : null}
    </div>
  );
}

/** Server-rendered KaTeX HTML. The HTML is produced by packages/core from authored content. */
export function Tex({ html, className = "", as: As = "span" }: { html: string; className?: string; as?: "span" | "div" | "p" | "h1" | "h2" }) {
  return <As className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center bg-ready text-canvas font-mono font-bold" style={{ width: size, height: size, borderRadius: size * 0.27, fontSize: size * 0.5 }}>
      Q
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-elevated rounded-[6px] animate-pulse ${className}`} />;
}

export function Notice({ tone, children, className = "" }: { tone: "error" | "success" | "info" | "warn"; children: ReactNode; className?: string }) {
  const t = { error: "border-red/60 bg-red/10 text-red", success: "border-ready/60 bg-ready/10 text-ready", info: "border-blue/50 bg-blue/10 text-ink-2", warn: "border-working/60 bg-working/10 text-working" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`border rounded-[8px] px-4 py-3 text-[12.5px] ${t} ${className}`}>
      {children}
    </div>
  );
}

/** Frame 13 · Edge states card. */
export function EdgeCard({ label, tone, title, children, actions }: { label: string; tone: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card className="p-5 flex flex-col gap-3">
      <Label color={tone}>{label}</Label>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <div className="text-[12px] leading-[19px] text-ink-2">{children}</div>
      {actions ? <div className="flex gap-2 pt-3">{actions}</div> : null}
    </Card>
  );
}

export function DesktopRequired() {
  return (
    <div className="desktop-required min-h-screen flex-col items-center justify-center gap-5 px-8 text-center bg-canvas">
      <Logo size={40} />
      <h1 className="text-[22px] font-semibold">Quant Academy needs a desktop</h1>
      <p className="text-[14px] leading-[22px] text-ink-2 max-w-[320px]">
        Practice is timed and measured. A cramped screen would make the timing — and your score — mean something different, so the app only runs at 1024px and wider.
      </p>
      <p className="text-[12px] text-ink-3 max-w-[300px]">If you zoomed in, zoom back out. Otherwise, open this on a laptop.</p>
    </div>
  );
}

export function PageTitle({ children, right, tabs }: { children: ReactNode; right?: ReactNode; tabs?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-5">
      <div className="flex items-center gap-5">
        <h1 className="text-[20px] font-semibold text-ink">{children}</h1>
        {tabs}
      </div>
      {right}
    </div>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string }[]; active: string }) {
  return (
    <nav className="flex bg-surface border border-line rounded-[8px] p-[3px] gap-[2px]" aria-label="Sections">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.href === active ? "page" : undefined} className={`px-3 py-[6px] rounded-[6px] text-[12px] ${focusRing} ${i.href === active ? "bg-elevated text-ink" : "text-ink-2 hover:text-ink"}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Focus-surface header: breadcrumb on the left, close on the right (frames 03, 28–31). */
export function FocusHeader({ crumbs, close = "/home", right }: { crumbs: { href?: string; label: string }[]; close?: string; right?: ReactNode }) {
  return (
    <header className="h-14 border-b border-line flex items-center justify-between px-7 no-print">
      <nav aria-label="Breadcrumb" className="flex items-center gap-[10px] text-[12.5px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-[10px]">
            {i > 0 ? <span className="text-ink-3">/</span> : null}
            {c.href ? (
              <Link href={c.href} className={`text-ink-2 hover:text-ink rounded ${focusRing}`}>
                {i === 0 ? "← " : ""}
                {c.label}
              </Link>
            ) : (
              <span className="text-ink font-medium" aria-current="page">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-4">
        {right}
        <Link href={close} aria-label="Close" className={`text-ink-3 hover:text-ink text-[18px] leading-none rounded ${focusRing}`}>
          ×
        </Link>
      </div>
    </header>
  );
}

/** Lesson step-type label colours (frames 03, 28–31). */
export const STEP_TONE: Record<string, string> = {
  concept: "text-ink-3",
  interactive: "text-ink-3",
  worked: "text-ink-3",
  faded: "text-ink-3",
  check: "text-working",
  trap: "text-red",
  summary: "text-ink-3",
};

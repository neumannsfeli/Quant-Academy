export const LEVEL_NAMES = ["Unseen", "Familiar", "Working", "Interview-ready"] as const;
export const LEVEL_COLOR = ["text-ink-3", "text-familiar", "text-working", "text-ready"] as const;
export const LEVEL_BG = ["bg-line", "bg-familiar", "bg-working", "bg-ready"] as const;

export function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function scoreColor(score: number, target = 75): string {
  if (score >= target) return "var(--level-ready)";
  if (score >= 40) return "var(--level-working)";
  return "var(--accent-red)";
}

export function relDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

import { getProgressHistory } from "@qa/core";
import { ButtonLink, Card, Label, PageTitle, Tabs } from "@/components/ui";
import { relDay } from "@/lib/format";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Progress over time" };

const TABS = [
  { href: "/progress", label: "Skill map" },
  { href: "/progress/history", label: "Over time" },
];
const KIND: Record<string, [string, string]> = {
  practice: ["Practice", "text-blue"],
  review: ["Review", "text-blue"],
  drill: ["Drill", "text-blue"],
  placement: ["Placement", "text-blue"],
  assessment: ["Assessment", "text-ready"],
  lesson: ["Lesson", "text-ink-3"],
  refresher: ["Refresher", "text-working"],
};

type Snap = Awaited<ReturnType<typeof getProgressHistory>>["snapshots"][number];

/** Frame 34 · Progress — over time. Server-rendered SVG; no chart library. */
export default async function HistoryPage() {
  const user = await requireUser();
  const h = await getProgressHistory(user.id, 42);
  const w = h.week;
  return (
    <div className="px-8 py-[22px]">
      <PageTitle tabs={<Tabs active="/progress/history" items={TABS} />} right={<span className="font-mono text-[9.5px] tracking-[0.12em] text-ink-3">LAST 6 WEEKS</span>}>
        Your progress
      </PageTitle>
      <div className="flex gap-4 items-start max-[1150px]:flex-col">
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex justify-between items-center mb-3">
              <Label>Readiness</Label>
              <div className="flex gap-4 text-[10.5px] text-ink-2">
                <span className="flex items-center gap-2"><span className="w-4 h-[2px] bg-ink" />readiness</span>
                {h.weakestDomain ? <span className="flex items-center gap-2"><span className="w-4 h-[2px] bg-red" />weakest domain — {h.weakestDomain.name.toLowerCase()}</span> : null}
              </div>
            </div>
            {h.snapshots.length >= 2 ? (
              <ReadinessChart snaps={h.snapshots} />
            ) : (
              <Empty>
                {h.snapshots.length === 1 ? "One day recorded so far. The line starts tomorrow — snapshots are taken nightly." : "Nothing measured yet. Your readiness line starts with the placement or your first practice session."}
              </Empty>
            )}
            <p className="text-[11px] text-ink-3 mt-3">Your score tracks the weakest domain closely — it is the ceiling. Lessons never move it; only practice and assessment do.</p>
          </Card>
          <Card className="p-5">
            <div className="flex justify-between items-center mb-3">
              <Label>Skills by status, week by week</Label>
              <div className="flex gap-4 text-[10.5px] text-ink-2">
                <span className="flex items-center gap-2"><span className="size-[9px] rounded-[2px] bg-[#6b7385]" />learned</span>
                <span className="flex items-center gap-2"><span className="size-[9px] rounded-[2px] bg-working" />working</span>
                <span className="flex items-center gap-2"><span className="size-[9px] rounded-[2px] bg-ready" />interview-ready</span>
              </div>
            </div>
            {h.snapshots.length >= 2 ? <StatusChart snaps={h.snapshots} /> : <Empty>Appears after your first week.</Empty>}
          </Card>
        </div>

        <div className="w-[360px] max-[1150px]:w-full shrink-0 flex flex-col gap-4">
          <Card className="p-5">
            <Label>This week</Label>
            <div className="grid grid-cols-4 gap-2 mt-3">
              <Stat label="lessons" value={String(w.lessons)} />
              <Stat label="practice" value={String(w.practice)} />
              <Stat label="accuracy" value={w.accuracy === null ? "—" : `${Math.round(w.accuracy * 100)}%`} color={w.accuracy !== null && w.accuracy >= 0.7 ? "var(--level-ready)" : undefined} />
              <Stat label="readiness" value={w.readinessDelta === null ? "—" : `${w.readinessDelta >= 0 ? "+" : ""}${w.readinessDelta}`} color={w.readinessDelta && w.readinessDelta > 0 ? "var(--level-ready)" : w.readinessDelta && w.readinessDelta < 0 ? "var(--accent-red)" : undefined} />
            </div>
          </Card>
          <Card className="p-5">
            <Label>Session history</Label>
            {h.sessions.length ? (
              <ul className="mt-2">
                {h.sessions.map((s, i) => {
                  const [kind, tone] = KIND[s.kind] ?? [s.kind, "text-ink-3"];
                  return (
                    <li key={i} className="flex items-center gap-3 py-[10px] border-b border-line last:border-0">
                      <span className="w-[68px] text-[10.5px] text-ink-3">{relDay(s.at)}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`font-mono text-[8px] tracking-[0.14em] uppercase ${tone}`}>{kind}</p>
                        <p className="text-[11.5px] text-ink-2 truncate">
                          {s.title}
                          {s.detail ? ` · ${s.detail}` : ""}
                        </p>
                      </div>
                      <span className={`font-mono text-[10.5px] ${s.firstScore != null ? "text-blue" : s.delta && s.delta > 0 ? "text-ready" : s.delta && s.delta < 0 ? "text-red" : "text-ink-3"}`}>
                        {s.firstScore != null ? `first score ${s.firstScore}` : s.delta === null ? "–" : `${s.delta > 0 ? "+" : ""}${s.delta}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-[11.5px] text-ink-2">No sessions yet.</p>
                <ButtonLink href="/home" kind="secondary" size="sm">Go to Home</ButtonLink>
              </div>
            )}
            <p className="text-[10.5px] text-ink-3 mt-3">Lessons and refreshers show — because they never change your score.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="h-[160px] bg-inset rounded-[8px] flex items-center justify-center text-[11.5px] text-ink-3 px-8 text-center">{children}</div>;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] text-ink-3">{label}</p>
      <p className="font-mono text-[16px]" style={{ color: color ?? "var(--text-primary)" }}>{value}</p>
    </div>
  );
}

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function ReadinessChart({ snaps }: { snaps: Snap[] }) {
  const W = 760;
  const H = 180;
  const L = 36;
  const n = snaps.length;
  const val = (s: Snap) => s.readiness ?? s.raw;
  const top = Math.max(60, Math.ceil(Math.max(...snaps.map(val), ...snaps.map((s) => s.weakest ?? 0)) / 20) * 20);
  const X = (i: number) => L + (i / (n - 1)) * (W - L - 16);
  const Y = (v: number) => 10 + (1 - v / top) * (H - 30);
  const provEnd = snaps.findIndex((s) => !s.provisional);
  const placement = snaps.findIndex((s) => s.event === "placement");
  const last = snaps[n - 1]!;
  const weak = snaps.map((s, i) => (s.weakest === null ? null : `${X(i)},${Y(s.weakest)}`)).filter(Boolean);
  const ticks = [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Readiness over ${n} days, now ${val(last)}.`}>
      {Array.from({ length: top / 20 + 1 }, (_, i) => i * 20).map((g) => (
        <g key={g}>
          <line x1={L} x2={W - 16} y1={Y(g)} y2={Y(g)} stroke="var(--border-subtle)" />
          <text x={4} y={Y(g) + 3} fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-mono)">{g}</text>
        </g>
      ))}
      {provEnd !== 0 ? (
        <>
          <rect x={L} y={10} width={(provEnd === -1 ? W - 16 : X(provEnd)) - L} height={H - 30} fill="var(--bg-elevated)" opacity={0.7} />
          <text x={L + 4} y={22} fontSize="9" fill="var(--text-muted)">provisional</text>
        </>
      ) : null}
      {weak.length > 1 ? <polyline fill="none" stroke="var(--accent-red)" strokeWidth={1.4} points={weak.join(" ")} /> : null}
      <polyline fill="none" stroke="var(--text-primary)" strokeWidth={1.8} points={snaps.map((s, i) => `${X(i)},${Y(val(s))}`).join(" ")} />
      {placement >= 0 ? (
        <g>
          <circle cx={X(placement)} cy={Y(val(snaps[placement]!))} r={3.5} fill="var(--accent-blue)" />
          <text x={X(placement) + 8} y={Y(val(snaps[placement]!)) - 6} fontSize="9.5" fill="var(--accent-blue)" fontFamily="var(--font-mono)">placement · {val(snaps[placement]!)}</text>
        </g>
      ) : null}
      <circle cx={X(n - 1)} cy={Y(val(last))} r={3.5} fill="var(--text-primary)" />
      <text x={X(n - 1)} y={Y(val(last)) - 9} fontSize="10" textAnchor="end" fill="var(--text-primary)" fontFamily="var(--font-mono)">{val(last)} today</text>
      {ticks.map((t, i) => (
        <text key={i} x={X(t)} y={H - 4} fontSize="9" textAnchor="middle" fill="var(--text-muted)" fontFamily="var(--font-mono)">{t === n - 1 ? "today" : fmtDate(snaps[t]!.date)}</text>
      ))}
    </svg>
  );
}

function StatusChart({ snaps }: { snaps: Snap[] }) {
  // One point per week: the last snapshot in each 7-day bucket.
  const weeks: Snap[] = [];
  for (let i = snaps.length - 1; i >= 0; i -= 7) weeks.unshift(snaps[i]!);
  if (weeks.length < 2) weeks.unshift({ ...snaps[0]! });
  const W = 760;
  const H = 150;
  const L = 36;
  const c = (s: Snap, k: string) => s.counts?.[k] ?? 0;
  const layers = weeks.map((s) => {
    const ready = c(s, "interview_ready");
    const working = ready + c(s, "working");
    const learned = working + c(s, "learned");
    return { ready, working, learned };
  });
  const top = Math.max(10, Math.ceil(Math.max(...layers.map((l) => l.learned)) / 10) * 10);
  const X = (i: number) => L + (i / (weeks.length - 1)) * (W - L - 16);
  const Y = (v: number) => 8 + (1 - v / top) * (H - 28);
  const area = (k: "ready" | "working" | "learned") => `${X(0)},${Y(0)} ${layers.map((l, i) => `${X(i)},${Y(l[k])}`).join(" ")} ${X(layers.length - 1)},${Y(0)}`;
  const last = layers[layers.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${last.learned} skills learned, ${last.working} working or better, ${last.ready} interview-ready.`}>
      {[0, top / 2, top].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - 16} y1={Y(g)} y2={Y(g)} stroke="var(--border-subtle)" />
          <text x={4} y={Y(g) + 3} fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-mono)">{g}</text>
        </g>
      ))}
      <polygon points={area("learned")} fill="#6b7385" opacity={0.55} />
      <polygon points={area("working")} fill="var(--level-working)" opacity={0.55} />
      <polygon points={area("ready")} fill="var(--level-ready)" opacity={0.7} />
      <text x={X(layers.length - 1)} y={Y(last.learned) - 6} fontSize="10" textAnchor="end" fill="var(--text-secondary)" fontFamily="var(--font-mono)">{last.learned} learned</text>
      {weeks.map((_, i) => (
        <text key={i} x={X(i)} y={H - 4} fontSize="9" textAnchor="middle" fill="var(--text-muted)" fontFamily="var(--font-mono)">wk {i + 1}</text>
      ))}
    </svg>
  );
}

import { getProgressMap } from "@qa/core";
import { SkillMap } from "@/components/progress/map";
import { PageTitle, Tabs } from "@/components/ui";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Progress" };

const TABS = [
  { href: "/progress", label: "Skill map" },
  { href: "/progress/history", label: "Over time" },
];

/** Frame 33 · Progress — skill map. */
export default async function ProgressPage() {
  const user = await requireUser();
  const map = await getProgressMap(user.id);
  const c = map.counts;
  const cards = [
    { label: "Learned", value: `${c.learned} / ${map.total}`, note: "learning path done", color: "var(--text-secondary)" },
    { label: "Proved", value: `${c.proved} / ${map.total}`, note: "Working or better", color: "var(--level-working)" },
    { label: "Interview-ready", value: `${c.interviewReady} / ${map.total}`, note: "proved cold", color: "var(--level-ready)" },
    { label: "Fading", value: String(c.fading), note: "retention below 0.85", color: "var(--level-working)" },
    { label: "Locked", value: String(c.locked), note: "a prerequisite not learned", color: "var(--text-muted)" },
  ];
  return (
    <div className="px-8 py-[22px]">
      <PageTitle tabs={<Tabs active="/progress" items={TABS} />} right={<span className="font-mono text-[9.5px] tracking-[0.12em] text-ink-3 uppercase">{map.archetypeName} · {map.total} skills</span>}>
        Your progress
      </PageTitle>
      <div className="grid grid-cols-5 gap-3 mb-4">
        {cards.map((k) => (
          <div key={k.label} className="bg-surface border border-line rounded-[10px] px-4 py-3">
            <p className="label">{k.label}</p>
            <p className="font-mono text-[18px] mt-1" style={{ color: k.color }}>{k.value}</p>
            <p className="text-[10px] text-ink-3">{k.note}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mb-3 text-[10.5px] text-ink-2">
        <div className="flex items-center gap-4">
          <Legend cls="border-dashed border-line-strong">Locked</Legend>
          <Legend cls="border-line-strong bg-canvas">Ready to learn</Legend>
          <Legend cls="border-line-strong bg-elevated">Learned</Legend>
          <Legend cls="border-working/70 bg-working/15">Working</Legend>
          <Legend cls="border-ready/60 bg-ready/15">Interview-ready</Legend>
          <span><span className="text-working font-mono">↓ r 0.71</span> fading</span>
        </div>
        <span className="text-ink-3">Tiers follow prerequisite depth — each lane reads top to bottom as a curriculum</span>
      </div>
      <SkillMap lanes={map.lanes} names={map.skillNames} />
    </div>
  );
}

function Legend({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-[6px]">
      <span className={`inline-block w-3 h-[10px] rounded-[3px] border ${cls}`} />
      {children}
    </span>
  );
}

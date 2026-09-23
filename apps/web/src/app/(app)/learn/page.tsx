import Link from "next/link";
import { getLearnPaths } from "@qa/core";
import { StartSession } from "@/components/actions";
import { Bar, ButtonLink, Card, Label, Meter, PageTitle, Tabs, focusRing } from "@/components/ui";
import { LEVEL_COLOR } from "@/lib/format";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Learn" };

/** Frame 32 · Learn — learning paths. */
export default async function LearnPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const user = await requireUser();
  const data = await getLearnPaths(user.id);
  const sp = await searchParams;
  const domains = data.domains.filter((d) => d.live);
  const active = domains.find((d) => d.id === sp.d) ?? domains.find((d) => d.id === data.upNext?.domainId) ?? domains[0];
  if (!active) return null;
  const upNext = data.upNext;

  return (
    <div className="px-8 py-[22px] flex gap-5 max-[1100px]:flex-col">
      <div className="flex-1 min-w-0">
        <PageTitle tabs={<Tabs active="/learn" items={[{ href: "/learn", label: "Learning paths" }, { href: "/learn/review-sheet", label: "Review sheet" }]} />}>Learn</PageTitle>
        <nav className="flex flex-wrap gap-2 mb-6" aria-label="Domains">
          {domains.map((d) => (
            <Link
              key={d.id}
              href={`/learn?d=${d.id}`}
              aria-current={d.id === active.id ? "page" : undefined}
              className={`px-3 py-[6px] rounded-[7px] border text-[11.5px] ${focusRing} ${d.id === active.id ? "border-blue bg-blue/10 text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}
            >
              {d.name} · {d.learned}/{d.total}
            </Link>
          ))}
        </nav>
        <div className="flex items-baseline gap-3 mb-4">
          <h2 id={active.id} className="text-[17px] font-semibold">{active.name}</h2>
          <span className="text-[11.5px] text-ink-3">{active.total} skills in prerequisite order · learn top to bottom</span>
        </div>
        <div className="grid grid-cols-[32px_1fr_174px_150px_110px] items-center px-4 pb-2 font-mono text-[8.5px] tracking-[0.12em] text-ink-3 uppercase">
          <span>#</span>
          <span>Skill</span>
          <span>Learn</span>
          <span>Practice</span>
          <span />
        </div>
        <ol className="flex flex-col gap-3">
          {active.rows.map((r) => {
            const locked = r.learnStatus === "locked";
            return (
              <li key={r.id} className={`grid grid-cols-[32px_1fr_174px_150px_110px] items-center px-4 py-[9px] rounded-[8px] ${r.upNext ? "bg-elevated border border-blue" : "bg-surface border border-transparent"}`}>
                <span className="font-mono text-[10.5px] text-ink-3">{r.index}</span>
                <Link href={`/skills/${encodeURIComponent(r.id)}`} className={`rounded ${focusRing}`}>
                  <span className={`block text-[12.5px] ${locked ? "text-ink-3" : "text-ink"}`}>{r.name}</span>
                  <span className="block font-mono text-[9.5px] text-ink-3">{r.minutes} min{r.hasLesson ? "" : " · reading"}</span>
                </Link>
                <span>
                  {locked ? (
                    <span className="block truncate pr-3 text-[10.5px] text-ink-3" title={`Locked · ${r.lockedReason}`}>Locked · {r.lockedReason}</span>
                  ) : r.learnStatus === "learned" ? (
                    <Pill tone="green">{r.justNow ? "Learned · just now" : "Learned"}</Pill>
                  ) : r.upNext ? (
                    <Pill tone="blue">Up next</Pill>
                  ) : r.learnStatus === "in_progress" ? (
                    <Pill tone="amber">In progress</Pill>
                  ) : (
                    <Pill tone="blue">Ready to learn</Pill>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <Meter level={r.level} locked={locked} />
                  <span className={`text-[10.5px] ${r.level ? LEVEL_COLOR[r.level] : "text-ink-3"}`}>{r.level ? r.levelName : "—"}</span>
                </span>
                <span className="flex justify-end">
                  {locked ? null : r.learnStatus === "learned" ? (
                    r.practiceUnlocked ? (
                      r.level === 3 ? (
                        <StartSession mode="review" kind="ghost" size="sm">Review</StartSession>
                      ) : (
                        <StartSession skillId={r.id} kind="secondary" size="sm">Practise</StartSession>
                      )
                    ) : (
                      <ButtonLink href={`/skills/${encodeURIComponent(r.id)}`} kind="ghost" size="sm">Open</ButtonLink>
                    )
                  ) : r.hasLesson ? (
                    <ButtonLink href={`/learn/${encodeURIComponent(r.id)}`} kind={r.upNext ? "primary" : "ghost"} size="sm">
                      {r.learnStatus === "in_progress" ? "Continue" : "Start lesson"}
                    </ButtonLink>
                  ) : (
                    <ButtonLink href={`/skills/${encodeURIComponent(r.id)}`} kind="ghost" size="sm">Read</ButtonLink>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <aside className="w-[300px] max-[1100px]:w-full shrink-0 flex flex-col gap-4 pt-[2px]">
        <Card className="p-[18px] flex flex-col gap-3">
          <Label>This domain</Label>
          <Stat label="learned" value={active.learned} total={active.total} color="var(--level-familiar)" />
          <Stat label="proved — Working or better" value={active.proved} total={active.total} color="var(--level-working)" />
          <Stat label="interview-ready" value={active.ready} total={active.total} color="var(--level-ready)" />
        </Card>
        {upNext ? (
          <Card className="p-[18px] flex flex-col gap-2 border-blue">
            <Label color="var(--accent-blue)">Up next</Label>
            <h3 className="text-[16px] font-semibold">{upNext.name}</h3>
            <p className="text-[11px] leading-[16px] text-ink-2">
              {upNext.minutes} minutes · {upNext.steps} steps{upNext.widget ? " · includes an interactive simulator" : ""}. Next in prerequisite order for your profile.
            </p>
            <ButtonLink href={`/learn/${encodeURIComponent(upNext.id)}`} className="mt-1">Start lesson</ButtonLink>
          </Card>
        ) : (
          <Card className="p-[18px]">
            <Label>Up next</Label>
            <p className="text-[11.5px] text-ink-2 mt-2">Nothing to learn right now — every path your prerequisites allow is done. Practice unlocks the next ones.</p>
          </Card>
        )}
        <div className="bg-inset rounded-[10px] p-[16px] flex flex-col gap-2">
          <Label>How things unlock</Label>
          <p className="text-[11px] leading-[17px] text-ink-2">
            Learn opens once the prerequisites are learned. Practice opens once they are proved — Working or better. Study can run one step ahead of proof, never further.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Pill({ tone, children }: { tone: "green" | "blue" | "amber"; children: React.ReactNode }) {
  const t = { green: "bg-ready/15 text-ready", blue: "bg-blue/15 text-blue", amber: "bg-working/15 text-working" }[tone];
  return <span className={`inline-block font-mono text-[8.5px] tracking-[0.12em] uppercase px-2 py-[4px] rounded-[4px] ${t}`}>{children}</span>;
}

function Stat({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex justify-between text-[11px]">
        <span className="text-ink-2">{label}</span>
        <span className="font-mono" style={{ color }}>{value} / {total}</span>
      </div>
      <Bar value={value} max={Math.max(1, total)} color={color} height={4} />
    </div>
  );
}

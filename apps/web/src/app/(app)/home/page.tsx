import Link from "next/link";
import { getHome } from "@qa/core";
import { StartSession } from "@/components/actions";
import { OutcomePrompt } from "@/components/outcome";
import { Bar, ButtonLink, Card, EdgeCard, Label, Meter, focusRing } from "@/components/ui";
import { LEVEL_COLOR, scoreColor } from "@/lib/format";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  const user = await requireUser();
  const home = await getHome(user.id);
  const sp = await searchParams;
  const r = home.readiness;
  const first = home.firstRun;
  const t = home.today;

  return (
    <div className="px-9 py-[26px] flex flex-col gap-5">
      {home.outcomePrompt || sp.outcome ? <OutcomePrompt /> : null}
      {home.openSession && !first ? (
        <div className="flex items-center justify-between bg-inset border border-working/40 rounded-[10px] px-5 py-3">
          <div>
            <Label color="var(--level-working)">Session interrupted</Label>
            <p className="text-[12px] text-ink-2 mt-1">Your answers were saved as you went. Finishing is worth more than starting again.</p>
          </div>
          <div className="flex gap-2">
            <ButtonLink href={`/session/${home.openSession.id}`} size="sm">Resume session</ButtonLink>
          </div>
        </div>
      ) : null}

      {/* Readiness */}
      <Card className="flex items-stretch gap-[26px] p-[22px] min-h-[168px]">
        <div className="w-[186px] flex flex-col gap-1 shrink-0">
          <Label>Interview readiness</Label>
          <div className="flex items-end gap-[3px] pb-2 pt-1">
            {r.score !== null ? (
              <span className="font-mono font-bold text-[48px] leading-none tracking-[-0.03em]" data-testid="readiness">{r.score}</span>
            ) : (
              <span className="font-mono font-bold text-[48px] leading-none text-ink-3" data-testid="readiness">—</span>
            )}
            <span className="font-mono text-[12px] text-ink-3">/100</span>
          </div>
          <p className="text-[10.5px] leading-[15px] text-ink-3">
            {r.score !== null
              ? r.validated
                ? `Validated by assessment until ${new Date(r.validatedUntil!).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`
                : "A weighted minimum across required domains — not a mean."
              : first
                ? "No score yet. It comes from measured performance, not a self-assessment."
                : `Provisional: ${r.provisionalReason}. It firms up at 20 answers and 5 per domain.`}
          </p>
        </div>
        <div className="w-px bg-line shrink-0" />
        <div className="flex-1 flex flex-col gap-[11px] min-w-0">
          <Label>Required domains · {first ? "nothing measured yet" : "coverage / target"}</Label>
          {r.domains.map((d) => (
            <div key={d.id} className="flex items-center gap-3">
              <span className="w-[196px] text-[11px] text-ink-2 shrink-0">{d.name}</span>
              <Bar className="w-[268px] shrink-0" value={first ? 0 : d.score} color={scoreColor(d.score, d.target)} />
              <span className="w-[54px] text-right font-mono text-[10.5px]" style={{ color: first ? "var(--text-muted)" : scoreColor(d.score, d.target) }}>
                {first ? "–" : `${d.score} / ${d.target}`}
              </span>
            </div>
          ))}
        </div>
        {first ? (
          <div className="w-[286px] shrink-0 bg-inset border-l-2 border-blue rounded-[8px] p-[14px] flex flex-col gap-2">
            <Label color="var(--accent-blue)">Start here</Label>
            <p className="text-[13px] font-medium">Take the placement</p>
            <p className="text-[10.5px] leading-[15px] text-ink-3">20 minutes, 24 adaptive items. Without it every skill stays Unseen and your first sessions go on finding out what you already know.</p>
          </div>
        ) : r.weakest ? (
          <div className="w-[286px] shrink-0 bg-inset border-l-2 border-red rounded-[8px] p-[14px] flex flex-col gap-2">
            <Label color="var(--accent-red)">Weakest link</Label>
            <p className="text-[13px] font-medium">{r.weakest.name}</p>
            <p className="text-[10.5px] leading-[15px] text-ink-3">
              Your worst required domain sets the ceiling. Moving this from {r.weakest.score} to {Math.min(100, r.weakest.score + 36)} is worth more than any other work available to you.
            </p>
          </div>
        ) : null}
      </Card>

      <div className="flex gap-5 items-start max-[1279px]:flex-col">
        {/* Skills */}
        <Card className="flex-1 min-w-0 p-5 flex flex-col gap-[13px] self-stretch">
          <div className="flex items-center justify-between">
            <Label>Your skills</Label>
            <span className="font-mono text-[9.5px] text-ink-3">
              {first
                ? `0 of ${home.skills.counts.total} started`
                : `${home.skills.counts.ready} interview-ready · ${home.skills.counts.locked} locked · full map in `}
              {!first ? <Link href="/progress" className="underline hover:text-ink">Progress</Link> : null}
            </span>
          </div>
          {home.skills.byDomain.map((d) => (
            <div key={d.id} className="flex flex-col gap-[5px]">
              <div className="flex items-center justify-between pb-[2px]">
                <span className="text-[11px] font-medium text-ink-2">{d.name}</span>
                <span className={`font-mono text-[9px] ${d.ready === 0 && !first && d.id === r.weakest?.id ? "text-red" : "text-ink-3"}`}>
                  {d.ready} / {d.total} ready
                </span>
              </div>
              {d.skills.map((k) => {
                const locked = k.status === "locked";
                return (
                  <Link key={k.id} href={`/skills/${k.id}`} className={`bg-inset rounded-[6px] px-[10px] py-[7px] flex items-center gap-3 hover:bg-elevated ${focusRing}`}>
                    <Meter level={k.level} locked={locked} />
                    <span className={`flex-1 text-[11.5px] ${locked ? "text-ink-3" : "text-ink"}`}>{k.name}</span>
                    <span className={`w-[94px] text-[10.5px] ${locked ? "text-ink-3" : LEVEL_COLOR[k.level]}`}>{locked ? "Locked" : k.levelName}</span>
                    <span className="w-[148px] text-right font-mono text-[9px] text-ink-3">{first && !locked ? "open now" : k.detail}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </Card>

        {/* Right rail — fixed at 336 (product spec §17.2) */}
        <div className="w-[336px] max-[1279px]:w-full shrink-0 flex flex-col gap-4">
          {first ? (
            <Card className="p-5 flex flex-col gap-3 border-blue">
              <Label>First thing to do</Label>
              <h2 className="text-[19px] font-semibold">Placement</h2>
              <p className="text-[11.5px] leading-[18px] text-ink-2">24 items · about 20 minutes · adaptive. You can stop halfway and keep everything it learned.</p>
              <StartSession mode="placement">Start placement</StartSession>
              <ButtonLink href="/learn" kind="ghost">New to this? Start with lessons</ButtonLink>
            </Card>
          ) : (
            <Card className="p-[18px] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label>Today&apos;s session</Label>
                {t ? <span className="font-mono text-[10px] text-ink-3">{t.lesson ? "1 lesson + " : ""}{t.items} items · ~{t.minutes} min</span> : null}
              </div>
              {t && !t.empty ? (
                <>
                  <div className="flex gap-[2px] h-[6px]">
                    {t.lesson ? <span className="rounded-[3px] bg-ready" style={{ flex: t.lesson.minutes }} /> : null}
                    {t.counts.review ? <span className="rounded-[3px] bg-working" style={{ flex: t.counts.review * 2.5 }} /> : null}
                    {t.counts.weakest ? <span className="rounded-[3px] bg-red" style={{ flex: t.counts.weakest * 2.5 }} /> : null}
                    {t.counts.new ? <span className="rounded-[3px] bg-blue" style={{ flex: t.counts.new * 2.5 }} /> : null}
                  </div>
                  {t.lesson ? <PlanRow dot="var(--level-ready)" label={`New lesson · ${t.lesson.name}`} value={`${t.lesson.minutes} min`} /> : null}
                  {t.counts.refreshers ? <PlanRow dot="var(--level-familiar)" label="Refresher" value={String(t.counts.refreshers)} /> : null}
                  <PlanRow dot="var(--level-working)" label="Reviews due · r < 0.85" value={String(t.counts.review)} />
                  <PlanRow dot="var(--accent-red)" label="Weakest-link bias" value={String(t.counts.weakest)} />
                  <PlanRow dot="var(--accent-blue)" label="New at p ≈ 0.75" value={String(t.counts.new)} />
                  <StartSession>{home.openSession?.mode === "practice" ? "Resume session" : "Start session"}</StartSession>
                </>
              ) : (
                <div className="text-[11.5px] leading-[18px] text-ink-2">
                  <p className="text-[13px] font-medium text-ink mb-1">Nothing to practise yet</p>
                  Practice opens once a skill’s prerequisites are proved. Learn the next path to unlock more.
                  <div className="pt-3"><ButtonLink href="/learn" kind="secondary" className="w-full">Go to Learn</ButtonLink></div>
                </div>
              )}
            </Card>
          )}

          <Card className="p-[18px] flex flex-col gap-[10px]">
            <div className="flex items-center justify-between">
              <Label>Fading</Label>
              {home.fading.length ? <span className="font-mono text-[10px] text-working">{home.fading.length} skill{home.fading.length === 1 ? "" : "s"}</span> : null}
            </div>
            {home.fading.length ? (
              <>
                {home.fading.slice(0, 3).map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Link href={`/skills/${f.id}`} className="flex-1 text-[11px] text-ink-2 hover:text-ink">{f.name}</Link>
                    <span className="font-mono text-[10px] text-working">r {f.retention?.toFixed(2)}</span>
                  </div>
                ))}
                {home.fading.length > 3 ? <p className="text-[10px] text-ink-3">and {home.fading.length - 3} more</p> : null}
                <StartSession mode="review" kind="secondary">Review {home.fading.length} now</StartSession>
              </>
            ) : (
              <p className="text-[11.5px] leading-[18px] text-ink-2">Nothing to review yet. Reviews appear once you have answered something correctly and it starts to decay.</p>
            )}
          </Card>

          <Card className="p-[18px] flex flex-col gap-[10px]">
            <div className="flex items-center justify-between">
              <Label>Assessment checkpoint</Label>
              <span className={`font-mono text-[10px] ${home.assessment.unlocked ? "text-ready" : "text-working"}`}>
                {home.assessment.unlocked ? "open" : home.assessment.nextAllowedAt ? `in ${Math.max(1, Math.ceil((new Date(home.assessment.nextAllowedAt).getTime() - Date.now()) / 86400000))}d` : "locked"}
              </span>
            </div>
            {home.assessment.unlocked || home.assessment.nextAllowedAt ? (
              <>
                <p className="text-[10.5px] leading-[15px] text-ink-3">
                  45 minutes, timed, mixed, no hints — the same runner with the gloves off.{r.score !== null ? ` Passing is what makes ${r.score} worth trusting.` : ""}
                </p>
                {home.assessment.unlocked ? <StartSession mode="assessment" kind="ghost">Start assessment</StartSession> : null}
              </>
            ) : (
              <p className="text-[11.5px] leading-[18px] text-ink-2">
                Unlocks at {home.assessment.needWorking} skills at Working — or after 14 days and 100 answers. You have {home.assessment.workingSkills} at Working. Nothing is worth validating before then.
              </p>
            )}
          </Card>
          {r.provisional && !first ? (
            <EdgeCard label="Placement skipped" tone="var(--accent-blue)" title="Your score is provisional">
              Readiness stays provisional until you have 20 scored answers and at least 5 in every required domain. Take the placement whenever you like, or keep practising and it will firm up on its own.
              <div className="pt-3"><StartSession mode="placement" kind="secondary" size="sm">Take the placement</StartSession></div>
            </EdgeCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlanRow({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-[6px] rounded-full" style={{ background: dot }} />
      <span className="flex-1 text-[11px] text-ink-2">{label}</span>
      <span className="font-mono text-[10px] text-ink-3">{value}</span>
    </div>
  );
}

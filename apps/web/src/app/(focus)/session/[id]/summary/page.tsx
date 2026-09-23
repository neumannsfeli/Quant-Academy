import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, schema as s } from "@qa/db";
import { endSession, getHome, type SessionSummary } from "@qa/core";
import { StartSession } from "@/components/actions";
import { Bar, ButtonLink, Card, Chip, Label, Tex } from "@/components/ui";
import { mmss, scoreColor } from "@/lib/format";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Summary" };

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser({ allowOnboarding: true });
  const { id } = await params;
  const [row] = await getDb().select().from(s.sessions).where(and(eq(s.sessions.id, id), eq(s.sessions.userId, user.id)));
  if (!row) notFound();
  const summary = (row.summary as SessionSummary | null) ?? (await endSession(id, user.id));
  const home = await getHome(user.id);
  if (row.mode === "placement") return <PlacementResult summary={summary} home={home} started={row.startedAt} ended={row.endedAt ?? new Date()} />;
  if (row.mode === "assessment") return <AssessmentResult summary={summary} home={home} started={row.startedAt} ended={row.endedAt ?? new Date()} />;
  return <SessionSummaryView summary={summary} fading={home.fading.length} />;
}

function Wrap({ children, width = 1080 }: { children: React.ReactNode; width?: number }) {
  return <div className="mx-auto px-6 pt-[150px] pb-16 flex flex-col gap-5" style={{ maxWidth: width }}>{children}</div>;
}

/** Frame 06 · Session summary. */
function SessionSummaryView({ summary: s, fading }: { summary: SessionSummary; fading: number }) {
  const delta = s.readinessBefore !== null && s.readinessAfter !== null ? s.readinessAfter - s.readinessBefore : null;
  return (
    <Wrap>
      <div className="text-center flex flex-col gap-2">
        <Label className="!text-[9.5px]">Session complete · {s.items} items · {s.minutes} min</Label>
        <h1 className="text-[22px] font-semibold">{s.headline}</h1>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Accuracy" value={`${Math.round(s.accuracy * 100)}%`} color={s.accuracy >= 0.75 ? "var(--level-ready)" : s.accuracy >= 0.5 ? "var(--level-working)" : "var(--accent-red)"} sub={`${s.correct} of ${s.items} correct${s.voided ? ` · ${s.voided} voided` : ""}`} />
        <Stat
          label="Readiness"
          value={s.provisional ? "provisional" : `${s.readinessBefore ?? "—"} → ${s.readinessAfter ?? "—"}`}
          color="var(--level-working)"
          sub={s.provisional ? "needs 20 answers, 5 per domain" : delta !== null ? `${delta >= 0 ? "+" : ""}${delta}${s.weakestDomain ? ` · ${s.weakestDomain.split(" & ")[0]!.toLowerCase()} capped it` : ""}` : ""}
        />
        <Stat label="Levels gained" value={String(s.levelsGained)} color={s.levelsGained ? "var(--level-ready)" : "var(--text-secondary)"} sub={[s.levelBreakdown.working ? `${s.levelBreakdown.working} → Working` : "", s.levelBreakdown.ready ? `${s.levelBreakdown.ready} → Ready` : "", s.levelBreakdown.familiar ? `${s.levelBreakdown.familiar} → Familiar` : ""].filter(Boolean).join(", ") || "none this time"} />
        <Stat label="Avg time" value={mmss(s.avgSec * 1000)} color={s.avgSec > s.targetSec ? "var(--accent-red)" : "var(--level-ready)"} sub={`target ${mmss(s.targetSec * 1000)}${s.slowestPosition ? ` · slow on ${s.slowestPosition}` : ""}`} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5 flex flex-col gap-3">
          <Label>What moved</Label>
          {s.moved.length ? (
            s.moved.map((m) => (
              <div key={m.skillId} className="flex justify-between text-[12.5px]">
                <Link href={`/skills/${m.skillId}`} className="text-ink-2 hover:text-ink">{m.name}</Link>
                <span className="font-mono text-[10.5px] text-ink-3">
                  {m.from} → <span className={m.direction === "up" ? (m.to === "Interview-ready" ? "text-ready" : m.to === "Working" ? "text-working" : "text-ink-2") : "text-red"}>{m.to}</span>
                </span>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-ink-3">No level changes this session — the evidence still counts toward θ.</p>
          )}
          <div className="border-t border-line pt-3 text-[11px] text-ink-3">Nothing advanced on hinted or repeated seeds — those attempts are capped at Working by design.</div>
        </Card>
        <Card className="p-5 flex flex-col gap-3">
          <Label>Misconceptions called out</Label>
          {s.misconceptions.length ? (
            s.misconceptions.map((m) => (
              <div key={m.id}>
                <p className="font-mono text-[12.5px] text-ink">{m.label}</p>
                <p className="text-[10.5px] text-ink-3">{m.count} item{m.count === 1 ? "" : "s"} · {m.skillName.toLowerCase()}</p>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-ink-3">None matched. Wrong answers that match no authored error are recorded, not guessed at.</p>
          )}
          <div className="border-t border-line pt-3 text-[11px] text-ink-3">Each distractor is tied to a named error at authoring time, which is how diagnosis stays specific instead of “you got {s.items - s.correct} wrong”.</div>
        </Card>
      </div>
      <Card className="p-5 flex flex-col gap-4">
        <div className="flex justify-between">
          <Label>What’s next</Label>
          {fading ? <span className="font-mono text-[10px] text-working">{fading} skill{fading === 1 ? " has" : "s have"} fallen below r 0.85 — reviews jump the queue</span> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ButtonLink href="/home" kind="secondary">Back to home</ButtonLink>
          {fading ? <StartSession mode="review">Review {fading} fading skill{fading === 1 ? "" : "s"}</StartSession> : <ButtonLink href="/progress">See your progress</ButtonLink>}
        </div>
      </Card>
    </Wrap>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <Card className="p-4 flex flex-col gap-2">
      <Label>{label}</Label>
      <p className="font-mono text-[22px] font-semibold" style={{ color }}>{value}</p>
      <p className="text-[10.5px] text-ink-3">{sub}</p>
    </Card>
  );
}

type Home = Awaited<ReturnType<typeof getHome>>;

/** Frame 18 · Placement result — the first readiness number. */
function PlacementResult({ summary, home, started, ended }: { summary: SessionSummary; home: Home; started: Date; ended: Date }) {
  const r = home.readiness;
  return (
    <Wrap width={900}>
      <div className="text-center flex flex-col gap-2">
        <Label className="!text-[9.5px]">Placement complete · {summary.items} items · {Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60000))} min</Label>
        <h1 className="text-[24px] font-semibold">Here is where you start.</h1>
      </div>
      <div className="flex gap-4">
        <Card className="w-[260px] p-6 flex flex-col gap-2">
          <Label>Interview readiness</Label>
          <p className="flex items-end gap-1"><span className="font-mono font-bold text-[56px] leading-none">{r.score ?? r.raw}</span><span className="font-mono text-[12px] text-ink-3">/100</span></p>
          <p className="text-[11px] text-ink-3">{r.score !== null ? "A starting estimate from placement. Not yet validated by an assessment." : `Provisional — ${r.provisionalReason}. You stopped early; everything answered still counts.`}</p>
        </Card>
        <Card className="flex-1 p-6 flex flex-col gap-3">
          <Label>{home.user.archetypeName} · required domains</Label>
          {r.domains.map((d) => (
            <div key={d.id} className="flex items-center gap-4">
              <span className="w-[200px] text-[12px] text-ink-2">{d.name}</span>
              <Bar className="flex-1" value={d.score} color={scoreColor(d.score, d.target)} />
              <span className="w-8 text-right font-mono text-[11px]" style={{ color: scoreColor(d.score, d.target) }}>{d.score}</span>
            </div>
          ))}
        </Card>
      </div>
      {r.weakest ? (
        <div className="bg-inset border-l-2 border-red rounded-[8px] px-5 py-4">
          <Label color="var(--accent-red)">Weakest link</Label>
          <p className="text-[14px] font-medium mt-1">{r.weakest.name}</p>
          <p className="text-[11px] text-ink-3 mt-1">This domain sets your ceiling. Your first session is built around it.</p>
        </div>
      ) : null}
      <Card className="p-5 flex flex-col gap-2 text-[12px] text-ink-2">
        <Label className="mb-1">Why this number is lower than you expect</Label>
        <p>· Placement measures where to aim you. It does not grant levels — every skill stays Unseen until you answer it in a real session.</p>
        <p>· Until a skill reaches Working, its contribution is capped. A score in the thirties after placement is normal, even for strong candidates.</p>
        <p>· Your worst required domain dominates. Averaging would flatter you; an interview will not.</p>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <ButtonLink href="/progress" kind="secondary">See all skills</ButtonLink>
        <StartSession>Start your first session · ~30 min</StartSession>
      </div>
    </Wrap>
  );
}

/** Frame 19 · Assessment result — the validated score. */
function AssessmentResult({ summary, home, started, ended }: { summary: SessionSummary; home: Home; started: Date; ended: Date }) {
  const a = summary.assessment!;
  const weakest = [...a.domains].filter((d) => d.items).sort((x, y) => x.percent - y.percent)[0];
  const until = new Date(ended.getTime() + 21 * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return (
    <Wrap width={980}>
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-2">
          <Label className="!text-[9.5px]">Assessment complete · {summary.items} items · {mmss(ended.getTime() - started.getTime())}</Label>
          <h1 className="text-[22px] font-semibold">{a.passed ? `Validated. Your readiness is ${home.readiness.score ?? home.readiness.raw} until ${until}.` : `Not passed this time. Readiness stays unvalidated.`}</h1>
        </div>
        <Chip tone={a.passed ? "green" : "red"} className="!text-[11px] !px-3 !py-2">{a.passed ? "Passed" : "Not passed"}</Chip>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Composite" value={`${a.composite}%`} color={a.composite >= 65 ? "var(--level-ready)" : "var(--accent-red)"} sub="pass mark 65%" />
        <Stat label="Weakest domain" value={`${weakest?.percent ?? 0}%`} color={(weakest?.percent ?? 0) >= 40 ? "var(--level-working)" : "var(--accent-red)"} sub={`floor 40% — ${(weakest?.percent ?? 0) >= 40 ? "cleared" : "not cleared"}`} />
        <Stat label="Readiness" value={`${summary.readinessBefore ?? "—"} → ${summary.readinessAfter ?? "—"}`} color="var(--level-ready)" sub={a.passed ? "now validated for 21 days" : "unvalidated"} />
        <Stat label="Recalibrated" value={`${a.recalibrated.length} skill${a.recalibrated.length === 1 ? "" : "s"}`} color={a.recalibrated.length ? "var(--accent-red)" : "var(--text-secondary)"} sub={a.recalibrated.length ? "moved back under test conditions" : "practice held up"} />
      </div>
      <Card className="p-5 flex flex-col gap-3">
        <div className="flex justify-between"><Label>Per-domain, under test conditions</Label><span className="text-[10.5px] text-ink-3">marks the 40% floor every domain must clear</span></div>
        {a.domains.map((d) => (
          <div key={d.id} className="flex items-center gap-4">
            <span className="w-[220px] text-[12px] text-ink-2">{d.name}</span>
            <Bar className="flex-1" value={d.percent} marker={40} color={d.percent >= 65 ? "var(--level-ready)" : d.percent >= 40 ? "var(--level-working)" : "var(--accent-red)"} />
            <span className="w-8 text-right font-mono text-[11px]">{d.items ? d.percent : "—"}</span>
          </div>
        ))}
      </Card>
      {a.recalibrated.length ? (
        <Card className="p-5 flex flex-col gap-2">
          <Label color="var(--accent-red)">Recalibrated under test conditions</Label>
          {a.recalibrated.map((r) => (
            <div key={r.skillId} className="flex gap-6 text-[12.5px]"><span className="w-[200px]">{r.name}</span><span className="font-mono text-[10.5px] text-working">{r.from} → {r.to}</span></div>
          ))}
          <p className="text-[11px] text-ink-3 mt-1">Practice is always slightly easier than test conditions. This is the correction, not a penalty — your score is now one you can trust.</p>
        </Card>
      ) : null}
      <Card className="p-5 flex flex-col gap-3">
        <Label>Every item, with its solution</Label>
        <div className="flex flex-col divide-y divide-line">
          {a.items.map((it) => (
            <details key={it.position} className="py-2">
              <summary className="cursor-pointer flex gap-4 text-[12px]">
                <span className="font-mono w-6 text-ink-3">{it.position}</span>
                <span className="flex-1 text-ink-2">{it.skillName}</span>
                <span className={it.correct ? "text-ready" : "text-red"}>{it.timedOut ? "timeout" : it.correct ? "correct" : "wrong"}</span>
              </summary>
              <div className="pl-10 pt-2 flex flex-col gap-1 text-[12px] text-ink-2">
                <p>you answered <span className="font-mono">{it.submitted ?? "—"}</span> · correct <Tex html={it.answerHtml} className="font-mono text-ready" /></p>
                {it.solutionHtml.map((h, i) => <Tex key={i} as="p" html={h} className="block" />)}
              </div>
            </details>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <ButtonLink href="/home" kind="secondary">Back to home</ButtonLink>
        {a.recalibrated.length ? <ButtonLink href={`/skills/${a.recalibrated[0]!.skillId}`}>Review the {a.recalibrated.length} recalibrated skill{a.recalibrated.length === 1 ? "" : "s"}</ButtonLink> : <ButtonLink href="/progress">See your progress</ButtonLink>}
      </div>
    </Wrap>
  );
}

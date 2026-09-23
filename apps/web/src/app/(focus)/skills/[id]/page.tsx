import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError, archetypeFor, getContent, getSkillPage } from "@qa/core";
import { StartSession } from "@/components/actions";
import { ButtonLink, Card, Chip, FocusHeader, Label, STEP_TONE, Tex, focusRing } from "@/components/ui";
import { LEVEL_NAMES } from "@/lib/format";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";

const LEVEL_DOT = ["var(--text-muted)", "var(--level-familiar)", "var(--level-working)", "var(--level-ready)"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const content = await getContent();
  return { title: content.skills.get(decodeURIComponent((await params).id))?.name ?? "Skill" };
}

/** Frame 03 · Skill — overview & learning path. */
export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = decodeURIComponent((await params).id);
  const page = await getSkillPage(user.id, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const content = await getContent();
  const arch = archetypeFor(content, user.archetypeId);
  const { skill, state, lesson, view } = page;
  const locked = view.status === "locked";
  const thetaPct = (t: number) => Math.max(0, Math.min(100, ((t + 2) / 5) * 100));

  return (
    <div className="min-h-screen flex flex-col">
      <FocusHeader crumbs={[{ href: "/home", label: "Home" }, { href: `/learn#${skill.domainId}`, label: skill.domainName }, { label: skill.name }]} />
      <div className="flex-1 flex max-[1100px]:flex-col">
        <main className="flex-1 min-w-0 px-14 py-10 flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <Chip>Band {skill.band}</Chip>
            <Chip className={locked ? "" : "bg-elevated"}>{locked ? "Locked" : LEVEL_NAMES[state.level]}</Chip>
            <Chip>~{skill.minutes} min</Chip>
            {arch.required[skill.id] !== undefined ? <Chip tone="blue">{arch.name}</Chip> : null}
          </div>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{skill.name}</h1>
            <p className="font-mono text-[10.5px] text-ink-3 mt-1">{skill.id}</p>
          </div>

          {lesson ? (
            <Card className="p-[18px] flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Label>
                    Learning path · {lesson.steps.length} steps · {skill.minutes} min
                  </Label>
                  {lesson.status === "completed" ? <Chip tone="green" className="py-[3px]">Completed</Chip> : lesson.status === "in_progress" ? <Chip tone="amber" className="py-[3px]">In progress</Chip> : null}
                </div>
                {page.learnUnlocked ? (
                  <ButtonLink href={`/learn/${encodeURIComponent(skill.id)}`} kind={lesson.status === "completed" ? "secondary" : "primary"} size="sm">
                    {lesson.status === "completed" ? "Review lesson" : lesson.status === "in_progress" ? "Continue lesson" : "Start lesson"}
                  </ButtonLink>
                ) : null}
              </div>
              <ol className="grid grid-cols-2 gap-x-8 gap-y-[9px]">
                {lesson.steps.map((st) => (
                  <li key={st.id} className="flex items-start gap-3 text-[12px]">
                    <span className={`w-3 ${st.done ? "text-ready" : "text-ink-3"}`} aria-label={st.done ? "done" : "not done"}>
                      {st.done ? "✓" : "·"}
                    </span>
                    <span className={`w-[82px] shrink-0 font-mono text-[8.5px] tracking-[0.12em] uppercase pt-[3px] ${STEP_TONE[st.type] ?? "text-ink-3"}`}>{st.type}</span>
                    <span className="text-ink-2">{st.title}</span>
                  </li>
                ))}
              </ol>
              {lesson.firstTry && lesson.status === "completed" ? (
                <p className="bg-inset rounded-[6px] px-3 py-2 text-[11.5px] text-ink-2">
                  Checks right first time: {lesson.firstTry.right} of {lesson.firstTry.total}
                  {lesson.entryBand ? ` — practice started at band ${lesson.entryBand}` : ""}. Revisiting the lesson is free and never scored.
                </p>
              ) : !page.learnUnlocked ? (
                <p className="bg-inset rounded-[6px] px-3 py-2 text-[11.5px] text-ink-2">Opens once you have learned {page.requires.filter((r) => r.level < 1).map((r) => r.name).join(", ")}.</p>
              ) : null}
            </Card>
          ) : (
            <Card className="p-[18px]">
              <Label>Learning path</Label>
              <p className="text-[12px] text-ink-2 mt-2">No guided path for this skill yet{page.readingHtml ? " — the reading below covers it." : "."} Practice still works: the first items start easy and adapt.</p>
            </Card>
          )}

          {lesson && lesson.keyResultsHtml.length ? (
            <Card className="p-[18px] flex flex-col gap-3">
              <Label>Key results · in your review sheet</Label>
              <ul className="flex flex-col gap-[10px]">
                {lesson.keyResultsHtml.map((h, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-[20px] text-ink-2">
                    <span className="text-ink-3">·</span>
                    <Tex html={h} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {lesson?.trapHtml ? (
            <div className="bg-surface border-l-2 border-red rounded-[8px] px-[18px] py-[14px]">
              <Label color="var(--accent-red)">The trap this lesson covers</Label>
              <Tex as="div" className="text-[12.5px] leading-[20px] text-ink-2 mt-2" html={lesson.trapHtml} />
            </div>
          ) : null}

          {page.readingHtml ? (
            <Card className="p-[18px]">
              <Label>{page.readingKind === "stub" ? "Reading · stub" : "Reading"}</Label>
              <Tex as="div" className="prose-qa text-[12.5px] leading-[20px] text-ink-2 mt-2" html={page.readingHtml} />
            </Card>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px]">
            <span className="label">Requires</span>
            {page.requires.length ? (
              page.requires.map((r) => (
                <Link key={r.id} href={`/skills/${encodeURIComponent(r.id)}`} className={`flex items-center gap-2 rounded hover:text-ink ${focusRing}`}>
                  <span className="size-[6px] rounded-full" style={{ background: LEVEL_DOT[r.level] }} />
                  <span className="text-ink-2">{r.name}</span>
                  <span className="font-mono text-[9px] text-ink-3">{LEVEL_NAMES[r.level]}</span>
                </Link>
              ))
            ) : (
              <span className="text-ink-3">nothing — an entry point</span>
            )}
          </div>
          {page.unlocks.length ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px]">
              <span className="label">Unlocks</span>
              {page.unlocks.map((u) => (
                <Link key={u.id} href={`/skills/${encodeURIComponent(u.id)}`} className={`text-ink-2 hover:text-ink rounded ${focusRing}`}>
                  {u.name}
                </Link>
              ))}
            </div>
          ) : null}
        </main>

        <aside className="w-[356px] max-[1100px]:w-full shrink-0 border-l border-line px-6 py-8 flex flex-col gap-5 min-[1101px]:sticky min-[1101px]:top-0 min-[1101px]:h-[calc(100vh-56px)] min-[1101px]:self-start overflow-y-auto">
          <Card className="p-[18px] flex flex-col gap-3 bg-inset">
            <div className="flex items-center justify-between">
              <Label>Your state</Label>
              <Chip>{locked ? "Locked" : LEVEL_NAMES[state.level]}</Chip>
            </div>
            <div className="flex items-end justify-between">
              <span className="font-mono text-[18px] font-semibold" style={{ color: state.theta === null ? "var(--text-muted)" : LEVEL_DOT[Math.max(1, state.level)] }}>
                θ {state.theta === null ? "—" : state.theta.toFixed(2)}
              </span>
              <span className="font-mono text-[10px] text-ink-3">target {state.target.toFixed(2)}</span>
            </div>
            <div className="relative h-[6px] bg-line rounded-full">
              <div className="h-full rounded-full" style={{ width: `${state.theta === null ? 0 : thetaPct(state.theta)}%`, background: LEVEL_DOT[Math.max(1, state.level)] }} />
              <div className="absolute top-[-3px] w-[2px] h-3 bg-ready" style={{ left: `${thetaPct(state.target)}%` }} />
            </div>
            <p className="text-[10.5px] leading-[15px] text-ink-3">
              {state.theta === null
                ? "No measurement yet. θ is set by your first answers, weighted by each item's difficulty."
                : state.inferred
                  ? "Inferred from placement and prerequisites — your first answers here will move it quickly."
                  : "θ is updated on every response, weighted by the item’s own difficulty. Timeouts count as wrong."}
            </p>
          </Card>

          <div className="flex flex-col gap-[10px]">
            <Label>To reach interview-ready</Label>
            <Criterion ok={state.criteria.streak >= state.criteria.streakNeeded} note={`${state.criteria.streak} of ${state.criteria.streakNeeded}`}>
              {state.criteria.streakNeeded} correct in a row on unseen seeds
            </Criterion>
            <Criterion ok={state.criteria.bandOk}>at band 3 or above</Criterion>
            <Criterion ok={state.criteria.limitOk}>inside the time limit</Criterion>
            <Criterion ok={state.criteria.retentionOk} note={state.retention !== null ? `now ${state.retention.toFixed(2)}` : undefined}>
              retention r ≥ {state.criteria.minRetention.toFixed(2)}
            </Criterion>
            <p className="text-[10.5px] leading-[15px] text-ink-3">Retries on the same seed and untimed attempts never advance past Working.</p>
          </div>

          {page.history.length ? (
            <div className="flex flex-col gap-2">
              <Label>Last {page.history.length} answers</Label>
              <div className="flex gap-[3px]">
                {[...page.history].reverse().map((h, i) => (
                  <span key={i} title={`band ${h.band} · ${h.correct ? "correct" : "wrong"}`} className={`h-[14px] flex-1 rounded-[2px] ${h.correct ? "bg-ready/80" : "bg-red/70"}`} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-auto flex flex-col gap-2">
            {page.practice.unlocked && page.practice.templates > 0 ? (
              <StartSession skillId={skill.id} size="lg">
                Practice 8 items
              </StartSession>
            ) : page.practice.templates === 0 ? (
              <p className="text-[11.5px] text-ink-2">Practice items for this skill are still being written.</p>
            ) : (
              <p className="text-[11.5px] text-ink-2">{view.detail ? `Practice opens when ${view.detail.replace(/^needs /, "")} is proved.` : "Practice is locked until the prerequisites are proved."}</p>
            )}
            <p className="text-[10.5px] text-ink-3">Solutions appear only after you answer.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Criterion({ ok, note, children }: { ok: boolean; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[10px] text-[11.5px]">
      <span className={`size-[13px] rounded-[3px] border ${ok ? "bg-ready border-ready" : "border-line-strong"}`} aria-label={ok ? "met" : "not met"} />
      <span className="flex-1 text-ink-2">{children}</span>
      {note ? <span className="font-mono text-[9.5px] text-working">{note}</span> : null}
    </div>
  );
}

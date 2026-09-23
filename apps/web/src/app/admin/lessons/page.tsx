import Link from "next/link";
import { getContent, lessonHealth, renderInline, renderMarkdown } from "@qa/core";
import { validateLesson, type LessonStep } from "@qa/learning";
import { StatusPill } from "@/components/admin/nav";
import { Label, STEP_TONE, Tex, focusRing } from "@/components/ui";
import { requireStaff } from "@/lib/server";

export const metadata = { title: "Lessons" };

/**
 * Frame 36 · Admin — lesson editor & health. Paths are authored as YAML in the content
 * repository and reach production through its validate → build → seed pipeline, so this
 * screen inspects a path, checks the §19.2 rules and shows how learners move through it.
 */
export default async function LessonsAdmin({ searchParams }: { searchParams: Promise<{ skill?: string; step?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const [content, health] = await Promise.all([getContent(), lessonHealth()]);
  const lessons = [...content.lessons.values()];
  const lesson = content.lessons.get(sp.skill ?? "") ?? lessons[0];
  if (!lesson) return <p className="m-auto text-ink-3 text-[12.5px]">No learning paths are loaded.</p>;
  const step = lesson.steps.find((s) => s.id === sp.step) ?? lesson.steps[0]!;
  const h = health.find((x) => x.skillId === lesson.skill_id);
  const issues = validateLesson(lesson, new Set(content.misconceptions.keys()));
  const checks = lesson.steps.filter((s) => s.type === "check");
  const maxLost = Math.max(1, ...(h?.dropOff.map((d) => d.lost) ?? [1]));
  const worst = h?.dropOff.reduce((a, b) => (b.lost > a.lost ? b : a), h.dropOff[0]!);

  return (
    <div className="flex-1 flex min-h-0">
      <aside className="w-[270px] shrink-0 border-r border-line bg-surface p-[14px] flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-50px)]">
        <select defaultValue={lesson.skill_id} aria-label="Learning path" className="bg-inset border border-line-strong rounded-[8px] px-2 py-2 text-[12px] font-mono" form="lesson-pick" name="skill">
          {lessons.map((l) => <option key={l.skill_id} value={l.skill_id}>{l.skill_id}</option>)}
        </select>
        <form id="lesson-pick" action="/admin/lessons"><button className="text-[11px] text-blue">Open path</button></form>
        <div>
          <p className="font-mono text-[12.5px]">{lesson.skill_id}</p>
          <div className="flex gap-2 mt-2">
            <span className="font-mono text-[9px] bg-elevated rounded px-[6px] py-[3px] text-ink-3">V{lesson.version}</span>
            <StatusPill status={lesson.status ?? "live"} />
            <span className="font-mono text-[9px] bg-elevated rounded px-[6px] py-[3px] text-ink-3">{lesson.est_minutes} MIN</span>
          </div>
        </div>
        <ol className="flex flex-col gap-1">
          {lesson.steps.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/lessons?skill=${encodeURIComponent(lesson.skill_id)}&step=${encodeURIComponent(s.id)}`} className={`grid grid-cols-[88px_1fr] gap-2 items-center rounded-[6px] border px-[10px] py-[7px] ${focusRing} ${s.id === step.id ? "border-blue bg-elevated" : "border-transparent bg-inset hover:bg-elevated/60"}`}>
                <span className={`font-mono text-[8.5px] tracking-[0.12em] uppercase ${STEP_TONE[s.type] ?? "text-ink-3"}`}>{s.type}</span>
                <span className="font-mono text-[10.5px] text-ink-2 truncate">{s.id}</span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="text-[10.5px] leading-[15px] text-ink-3 mt-auto">Paths are YAML in the content repository (<span className="font-mono">content/&lt;domain&gt;/&lt;node&gt;/path.yaml</span>). Edit there; validate.py and the seed step enforce these same rules.</p>
      </aside>

      <main className="flex-1 min-w-0 px-5 py-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-50px)]">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-mono">Step {lesson.steps.indexOf(step) + 1} · {step.id}</h1>
          <span className={`font-mono text-[8.5px] tracking-[0.12em] uppercase rounded px-[6px] py-[3px] bg-elevated ${STEP_TONE[step.type]}`}>{step.type}</span>
          <Link href={`/learn/${encodeURIComponent(lesson.skill_id)}?step=${encodeURIComponent(step.id)}&review=1`} className="ml-auto text-[11.5px] text-blue hover:underline">Preview as learner →</Link>
        </div>
        <StepDetail step={step} />
        {step.addresses?.length ? (
          <Field label="Addresses">
            <p className="font-mono text-[12px]">{step.addresses.join(", ")}</p>
          </Field>
        ) : null}
      </main>

      <aside className="w-[360px] shrink-0 border-l border-line p-[18px] flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-50px)]">
        <section className={`border rounded-[10px] p-4 flex flex-col gap-2 ${issues.some((i) => i.severity === "fail") ? "border-red/60" : "border-ready/60"}`}>
          <div className="flex justify-between items-center">
            <Label color={issues.some((i) => i.severity === "fail") ? "var(--accent-red)" : "var(--level-ready)"}>Path rules</Label>
            <span className={`font-mono text-[8.5px] rounded px-[6px] py-[3px] ${issues.some((i) => i.severity === "fail") ? "bg-red/15 text-red" : "bg-ready/15 text-ready"}`}>{issues.some((i) => i.severity === "fail") ? "FAIL" : "PASS"}</span>
          </div>
          <p className="text-[11px] text-ink-2">✓ {lesson.steps.length} steps · {lesson.est_minutes} min</p>
          <p className="text-[11px] text-ink-2">✓ {checks.length} checks{checks.at(-1) && "transfer" in checks.at(-1)! && (checks.at(-1) as { transfer?: boolean }).transfer ? ", last one is transfer" : ""}</p>
          {issues.map((i, k) => <p key={k} className={`text-[11px] ${i.severity === "fail" ? "text-red" : "text-working"}`}>{i.severity === "fail" ? "✗" : "!"} {i.message}</p>)}
          {!issues.length ? <p className="text-[11px] text-ink-2">✓ worked, faded, trap and check rules hold; misconception tags exist</p> : null}
        </section>
        <section className="bg-surface border border-line rounded-[10px] p-4 flex flex-col gap-3">
          <Label>Lesson health · v{lesson.version} · {h?.started ?? 0} starts</Label>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="completion" value={h?.completionRate == null ? "—" : `${Math.round(h.completionRate * 100)}%`} />
            <Metric label="lesson lift" value={h?.lift == null ? "—" : h.lift.toFixed(2)} color={h?.lift != null && h.lift > 1 ? "var(--level-ready)" : undefined} />
            <Metric label="lift sample" value={String(h?.liftN ?? 0)} />
          </div>
          <Label>Drop-off by step</Label>
          <div className="flex items-end gap-[4px] h-[60px]">
            {(h?.dropOff ?? lesson.steps.map((s) => ({ id: s.id, lost: 0 }))).map((d, i) => (
              <div key={d.id} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-full rounded-[2px] ${worst && d.id === worst.id && d.lost > 0 ? "bg-red" : "bg-line-strong"}`} style={{ height: `${Math.max(2, (d.lost / maxLost) * 50)}px` }} title={`${d.lost} left at ${d.id}`} />
                <span className="font-mono text-[8px] text-ink-3">{i + 1}</span>
              </div>
            ))}
          </div>
          {worst && worst.lost > 0 ? <p className="text-[11px] text-working">{worst.lost} learner{worst.lost === 1 ? "" : "s"} left at “{worst.title}” — the highest drop-off in the path.</p> : <p className="text-[11px] text-ink-3">Not enough starts to see drop-off yet.</p>}
          <Label>Checks · first-try rate</Label>
          {(h?.checks ?? []).map((c) => (
            <div key={c.id} className="flex justify-between text-[11px] font-mono">
              <span className="text-ink-2">{c.id}</span>
              <span className={c.firstTryRate == null ? "text-ink-3" : c.firstTryRate >= 0.7 ? "text-ready" : "text-working"}>{c.firstTryRate == null ? "—" : `${Math.round(c.firstTryRate * 100)}%`}</span>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] text-ink-3">{label}</p>
      <p className="font-mono text-[15px]" style={{ color: color ?? "var(--text-primary)" }}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="label">{label}</span>
      <div className="bg-inset border border-line-strong rounded-[8px] px-3 py-[9px] text-[12.5px]">{children}</div>
    </div>
  );
}

function StepDetail({ step }: { step: LessonStep }) {
  const title = step.title ? <Field label="Title">{step.title}</Field> : null;
  switch (step.type) {
    case "concept":
    case "summary":
      return <>{title}<Field label="Body"><Tex as="div" className="prose-qa !text-[13px]" html={renderMarkdown(step.body)} /></Field></>;
    case "interactive":
      return (
        <>
          {title}
          <Field label="Widget"><span className="font-mono">{step.widget}</span> <span className="font-mono text-ink-3 text-[11px]">{JSON.stringify(step.config)}</span></Field>
          <Field label="Body"><Tex as="div" className="prose-qa !text-[13px]" html={renderMarkdown(step.body)} /></Field>
          {step.note ? <Field label="Note"><Tex html={renderInline(step.note)} /></Field> : null}
        </>
      );
    case "worked":
    case "faded":
      return (
        <>
          {title}
          <Field label="Problem"><Tex html={renderInline(step.problem)} /></Field>
          <div className="flex flex-col gap-1">
            <span className="label">Steps</span>
            {step.steps.map((s, i) => (
              <div key={i} className="bg-surface border border-line rounded-[6px] px-3 py-2 text-[12px]">
                <span className="font-mono text-ink-3 mr-2">{i + 1}</span>
                {"blank" in s ? (
                  <span><span className="text-working font-mono text-[10px] mr-2">BLANK</span><Tex html={renderInline(s.blank.prompt)} /> <span className="font-mono text-ready">= {s.blank.answer}</span></span>
                ) : (
                  <>
                    <Tex html={renderInline(s.text)} />
                    {"self_explain" in s && s.self_explain ? <p className="text-[11px] text-blue mt-1">why? {s.self_explain.prompt} ({s.self_explain.options.length} options)</p> : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      );
    case "check":
      return (
        <>
          {title}
          <Field label={`Check · ${step.check.type}${step.transfer ? " · transfer" : ""}`}><Tex html={renderInline(step.check.stem)} /></Field>
          <Field label="Answer"><span className="font-mono text-ready">{step.check.type === "mcq" ? step.check.answer_label : step.check.answer}</span></Field>
          {step.check.hints?.length ? <Field label="Hints">{step.check.hints.map((x, i) => <p key={i}><Tex html={renderInline(x)} /></p>)}</Field> : null}
          <Field label="Solution"><Tex html={renderInline(step.check.solution)} /></Field>
        </>
      );
    case "trap":
      return (
        <>
          {title}
          <Field label="Prompt"><Tex html={renderInline(step.prompt)} /></Field>
          <div className="flex flex-col gap-1">
            <span className="label">Flawed solution · mark the broken step</span>
            {step.flawed_solution.map((f, i) => (
              <div key={i} className={`rounded-[6px] border px-3 py-2 text-[12px] font-mono flex justify-between gap-3 ${i === step.error_step ? "border-red bg-red/5" : "border-line bg-surface"}`}>
                <span><span className="text-ink-3 mr-2">{i + 1}</span>{f}</span>
                {i === step.error_step ? <span className="text-[8.5px] tracking-[0.12em] text-red bg-red/15 rounded px-[6px] py-[3px] h-fit">ERROR STEP</span> : null}
              </div>
            ))}
          </div>
          <Field label="Explanation"><Tex html={renderInline(step.explanation)} /></Field>
        </>
      );
  }
}

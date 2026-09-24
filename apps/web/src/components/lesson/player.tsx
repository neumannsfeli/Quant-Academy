"use client";

/**
 * Frames 28–31 · the lesson player. Nothing here is scored (product spec §19): hints,
 * retries and solutions are free. Answers are graded on the server; the client never
 * holds them. Continue is gated only on what canComplete needs — every step seen,
 * every check and blank solved.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { call, copyFor } from "@/lib/client";
import { StartSession } from "../actions";
import { Button, ButtonLink, Chip, Label, STEP_TONE, Tex, btnClass, focusRing } from "../ui";
import { LessonWidget } from "./widgets";

type Opt = { id: string; html: string };
export type ClientStep = {
  id: string;
  type: "concept" | "interactive" | "worked" | "faded" | "check" | "trap" | "summary";
  title: string | null;
  minutes: number | null;
  viewed: boolean;
  bodyHtml?: string;
  keyResultsHtml?: string[];
  widget?: string;
  config?: Record<string, unknown>;
  noteHtml?: string | null;
  problemHtml?: string;
  steps?: ({ html: string; selfExplain: { promptHtml: string; options: Opt[]; answered: boolean } | null } | { blank: true; index: number; promptHtml: string; hints: number; solved: boolean } | { blank: false; index: number; html: string })[];
  transfer?: boolean;
  kind?: "numeric" | "mcq";
  stemHtml?: string;
  options?: Opt[];
  hints?: number;
  solved?: boolean;
  firstTry?: boolean;
  attempted?: boolean;
  promptHtml?: string;
  flawed?: string[];
};
export type LessonData = {
  skillId: string;
  skillName: string;
  domainName: string;
  title: string;
  estMinutes: number;
  status: string;
  resumeStepId: string;
  canComplete: boolean;
  steps: ClientStep[];
  keyResultsHtml: string[];
  misconceptionsCovered: number;
  firstTry: { right: number; total: number };
  cause?: string | null;
};
type Attempt = { correct: boolean; feedbackHtml: string | null; hintsRemaining: number; solutionAvailable: boolean; solutionHtml: string | null; firstTry: boolean; explanationHtml?: string | null };
type Done = { levelBefore: number; levelAfter: number; entryBand: number; firstTryRate: number };

const TYPE_LABEL: Record<string, string> = { concept: "Concept", interactive: "Interactive", worked: "Worked example", faded: "Faded", check: "Check", trap: "Trap", summary: "Summary" };
const LEVELS = ["Unseen", "Familiar", "Working", "Interview-ready"];

export function LessonPlayer({ lesson, mode, sessionId, initialStep, review }: { lesson: LessonData; mode: "lesson" | "refresher"; sessionId: string | null; initialStep: string | null; review: boolean }) {
  const router = useRouter();
  const steps = lesson.steps;
  const startIdx = Math.max(0, steps.findIndex((s) => s.id === (initialStep ?? (lesson.status === "completed" ? steps[0]!.id : lesson.resumeStepId))));
  const [idx, setIdx] = useState(startIdx);
  const [viewed, setViewed] = useState(() => new Set(steps.filter((s) => s.viewed).map((s) => s.id)));
  const [solved, setSolved] = useState(() => {
    const out = new Set<string>();
    for (const s of steps) {
      if (s.type === "check" && s.solved) out.add(s.id);
      if (s.type === "faded") for (const b of s.steps ?? []) if ("blank" in b && b.blank && b.solved) out.add(`${s.id}#${b.index}`);
      if (s.type !== "check" && s.type !== "faded") out.add(s.id);
    }
    return out;
  });
  const [done, setDone] = useState<Done | null>(null);
  const [nextLesson, setNextLesson] = useState<{ id: string; name: string; minutes: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step = steps[idx]!;
  const base = `/api/lessons/${encodeURIComponent(lesson.skillId)}`;

  useEffect(() => {
    if (mode === "lesson" && lesson.status === "not_started") call(`${base}/start`, { method: "POST" }).catch(() => {});
  }, [base, lesson.status, mode]);

  useEffect(() => {
    call(`${base}/steps/${encodeURIComponent(step.id)}/view${review ? "?review=1" : ""}`, { method: "POST" })
      .then(() => setViewed((v) => new Set(v).add(step.id)))
      .catch(() => {});
    document.getElementById("lesson-main")?.focus();
  }, [base, step.id, review]);

  const markSolved = useCallback((key: string) => setSolved((s) => new Set(s).add(key)), []);
  const stepDone = (s: ClientStep) => {
    if (s.type === "check") return solved.has(s.id);
    if (s.type === "faded") return (s.steps ?? []).every((b) => !("blank" in b && b.blank) || solved.has(`${s.id}#${b.index}`));
    return true;
  };
  const canContinue = stepDone(step);
  const last = idx === steps.length - 1;
  const exitHref = sessionId ? `/session/${sessionId}` : review ? "/home" : `/skills/${encodeURIComponent(lesson.skillId)}`;

  async function finish() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "refresher") {
        await call(`${base}/refresher`, { json: { resolution: "completed" } });
        router.push(sessionId ? `/session/${sessionId}` : "/home");
        return;
      }
      const r = await call<Done>(`${base}/complete`, { method: "POST" });
      const paths = await call<{ upNext: { id: string; name: string; minutes: number } | null }>("/api/learn/paths").catch(() => ({ upNext: null }));
      setNextLesson(paths.upNext && paths.upNext.id !== lesson.skillId ? paths.upNext : null);
      setDone(r);
    } catch (e) {
      setErr(copyFor(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Complete lesson={lesson} done={done} sessionId={sessionId} next={nextLesson} />;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b border-line grid grid-cols-[1fr_auto_1fr] items-center px-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-[10px] text-[12.5px]">
          <Link href={`/learn`} className={`text-ink-2 hover:text-ink rounded ${focusRing}`}>← {lesson.domainName}</Link>
          <span className="text-ink-3">/</span>
          <span className="font-medium">{lesson.skillName}</span>
        </nav>
        <div className="flex flex-col items-center gap-[6px]">
          <span className="font-mono text-[10px] text-ink-3">Step {idx + 1} of {steps.length}</span>
          <div className="flex gap-[3px]" aria-hidden>
            {steps.map((s, i) => (
              <span key={s.id} className={`h-[3px] w-[26px] rounded-full ${i === idx ? "bg-blue" : viewed.has(s.id) && stepDone(s) ? "bg-ready" : "bg-line"}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <span className="border border-ready/50 bg-ready/10 rounded-[6px] px-[10px] py-[5px] font-mono text-[8.5px] tracking-[0.12em] text-ready">
            <span className="text-ink-3">MODE</span>&nbsp; {mode === "refresher" ? "REFRESHER" : review ? "REVIEW" : "LEARN"}
          </span>
          <Link href={exitHref} className={`text-[12px] text-ink-2 hover:text-ink rounded ${focusRing}`}>Save &amp; exit</Link>
        </div>
      </header>

      <div className="flex-1 flex">
        <aside className="w-[272px] shrink-0 border-r border-line bg-surface px-4 py-5 flex flex-col gap-4">
          <div>
            <Label>{mode === "refresher" ? "Refresher" : "Learning path"} · {lesson.estMinutes} min</Label>
            <p className="text-[14px] font-semibold mt-1">{lesson.skillName}</p>
          </div>
          <ol className="flex flex-col gap-1">
            {steps.map((s, i) => {
              const ok = viewed.has(s.id) && stepDone(s) && i !== idx;
              const reachable = i <= idx || steps.slice(0, i).every((p) => viewed.has(p.id) && stepDone(p));
              return (
                <li key={s.id}>
                  <button
                    disabled={!reachable}
                    onClick={() => setIdx(i)}
                    aria-current={i === idx ? "step" : undefined}
                    className={`w-full text-left flex items-start gap-3 rounded-[8px] px-[10px] py-[7px] border ${focusRing} ${i === idx ? "border-blue bg-elevated" : "border-transparent hover:bg-elevated/60"} disabled:cursor-default disabled:hover:bg-transparent`}
                  >
                    <span className={`mt-[3px] size-[17px] shrink-0 rounded-full border flex items-center justify-center font-mono text-[8.5px] ${ok ? "border-ready text-ready" : i === idx ? "border-blue text-blue bg-blue/15" : "border-line-strong text-ink-3"}`}>
                      {ok ? "✓" : i + 1}
                    </span>
                    <span className="flex flex-col">
                      <span className={`font-mono text-[8px] tracking-[0.12em] uppercase ${STEP_TONE[s.type] ?? "text-ink-3"}`}>{s.type}</span>
                      <span className={`text-[11.5px] ${i === idx ? "text-ink" : reachable ? "text-ink-2" : "text-ink-3"}`}>{s.title ?? TYPE_LABEL[s.type]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-auto bg-inset rounded-[8px] px-3 py-[10px] text-[10.5px] leading-[15px] text-ink-3">
            Nothing here affects your score. Hints, retries and solutions are free — this is where getting it wrong is the point.
          </p>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <main id="lesson-main" tabIndex={-1} className="flex-1 w-full max-w-[820px] mx-auto px-6 pt-9 pb-6 flex flex-col gap-5 outline-none focus:outline-none focus-visible:!outline-none">
            {mode === "refresher" && idx === 0 && lesson.cause ? (
              <p className="bg-familiar/10 border border-familiar/40 rounded-[8px] px-4 py-3 text-[12px] text-ink-2">
                Recent answers on {lesson.skillName} suggest a gap. These {steps.length} steps are the parts of the lesson that address it.
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <span className={`font-mono text-[9px] tracking-[0.14em] uppercase ${step.type === "check" ? "text-working" : step.type === "trap" ? "text-red" : "text-ink-3"}`}>
                {TYPE_LABEL[step.type]}
                {step.minutes ? ` · ${step.minutes} min` : ""}
              </span>
              {step.type === "check" ? <Chip tone="green" className="py-[3px]">Never scored</Chip> : null}
              {step.transfer ? <Chip className="py-[3px]">Different clothes</Chip> : null}
            </div>
            <h1 className="text-[26px] font-semibold tracking-[-0.01em]">{step.title ?? TYPE_LABEL[step.type]}</h1>
            <StepBody key={step.id} step={step} base={base} onSolved={markSolved} />
          </main>
          <footer className="w-full max-w-[820px] mx-auto px-6 pb-7 flex items-center justify-between gap-4">
            <Button kind="secondary" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
              ← Back
            </Button>
            <FlagStep base={base} stepId={step.id} />
            <div className="flex flex-col items-end gap-1">
              {last ? (
                <Button onClick={finish} loading={busy} disabled={!steps.every((s) => stepDone(s))}>
                  {mode === "refresher" ? "Finish refresher" : "Finish path"} →
                </Button>
              ) : (
                <Button kind={canContinue ? "primary" : "ghost"} disabled={!canContinue} onClick={() => setIdx((i) => i + 1)}>
                  Continue →
                </Button>
              )}
              {!canContinue ? <span className="text-[10px] text-ink-3">Solve it to continue — use a hint or the solution if you need to.</span> : null}
              {err ? <span className="text-[11px] text-red" role="alert">{err}</span> : null}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function StepBody({ step, base, onSolved }: { step: ClientStep; base: string; onSolved: (key: string) => void }) {
  const stepUrl = `${base}/steps/${encodeURIComponent(step.id)}`;
  switch (step.type) {
    case "concept":
      return <Tex as="div" className="prose-qa" html={step.bodyHtml ?? ""} />;
    case "summary":
      return (
        <>
          <Tex as="div" className="prose-qa" html={step.bodyHtml ?? ""} />
          {step.keyResultsHtml?.length ? (
            <div className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-3">
              <Label>Key results · saved to your review sheet</Label>
              {step.keyResultsHtml.map((h, i) => (
                <Tex key={i} as="div" html={h} className="text-[13px] leading-[21px] text-ink" />
              ))}
            </div>
          ) : null}
        </>
      );
    case "interactive":
      return (
        <>
          <Tex as="div" className="prose-qa" html={step.bodyHtml ?? ""} />
          <LessonWidget widget={step.widget ?? ""} config={step.config ?? {}} />
          {step.noteHtml ? <Tex as="p" className="border border-blue/50 bg-blue/5 rounded-[8px] px-4 py-3 text-[12.5px] text-ink-2" html={step.noteHtml} /> : null}
        </>
      );
    case "worked":
      return <Worked step={step} url={stepUrl} />;
    case "faded":
      return <Faded step={step} url={stepUrl} onSolved={onSolved} />;
    case "check":
      return <Check step={step} url={stepUrl} onSolved={() => onSolved(step.id)} />;
    case "trap":
      return <Trap step={step} url={stepUrl} />;
  }
}

function Problem({ html }: { html: string }) {
  return (
    <div className="bg-surface border border-line rounded-[10px] px-4 py-3">
      <Label>Problem</Label>
      <Tex as="p" className="text-[14px] leading-[22px] text-ink mt-1" html={html} />
    </div>
  );
}

function Num({ n }: { n: number }) {
  return <span className="size-[22px] shrink-0 rounded-full border border-line-strong flex items-center justify-center font-mono text-[10px] text-ink-3">{n}</span>;
}

function Worked({ step, url }: { step: ClientStep; url: string }) {
  const rows = (step.steps ?? []) as { html: string; selfExplain: { promptHtml: string; options: Opt[]; answered: boolean } | null }[];
  // Reveal one step at a time; a self-explanation must be answered before the next reveal.
  const [shown, setShown] = useState(1);
  const [answered, setAnswered] = useState<Record<number, boolean>>(() => Object.fromEntries(rows.map((r, i) => [i, !!r.selfExplain?.answered])));
  const blocked = rows.slice(0, shown).some((r, i) => r.selfExplain && !answered[i]);
  return (
    <>
      <Problem html={step.problemHtml ?? ""} />
      <ol className="flex flex-col gap-4">
        {rows.slice(0, shown).map((r, i) => (
          <li key={i} className="flex gap-4">
            <Num n={i + 1} />
            <div className="flex-1 flex flex-col gap-3">
              <Tex as="div" className="prose-qa [&_p]:mb-0 text-[13.5px]" html={r.html} />
              {r.selfExplain ? <SelfExplain url={url} part={i} q={r.selfExplain} onDone={() => setAnswered((a) => ({ ...a, [i]: true }))} /> : null}
            </div>
          </li>
        ))}
      </ol>
      {shown < rows.length ? (
        <div>
          <button disabled={blocked} onClick={() => setShown((n) => n + 1)} className={`border border-dashed border-line-strong rounded-[8px] px-5 py-[10px] text-[12.5px] text-ink-2 hover:text-ink disabled:opacity-40 ${focusRing}`}>
            Reveal step {shown + 1}
          </button>
        </div>
      ) : null}
    </>
  );
}

function SelfExplain({ url, part, q, onDone }: { url: string; part: number; q: { promptHtml: string; options: Opt[]; answered: boolean }; onDone: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [res, setRes] = useState<Attempt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <fieldset className="border border-blue/60 rounded-[10px] p-4 flex flex-col gap-2">
      <legend className="sr-only">Before you go on</legend>
      <span className="font-mono text-[8.5px] tracking-[0.14em] text-blue">BEFORE YOU GO ON — WHY?</span>
      <Tex as="p" className="text-[13px] text-ink" html={q.promptHtml} />
      {q.options.map((o) => {
        const chosen = picked === o.id;
        const tone = chosen && res ? (res.correct ? "border-ready bg-ready/10" : "border-red/70 bg-red/5") : "border-line hover:border-line-strong";
        return (
          <button
            key={o.id}
            onClick={async () => {
              setPicked(o.id);
              setErr(null);
              try {
                const r = await call<Attempt>(`${url}/attempt`, { json: { raw: o.id, part } });
                setRes(r);
                if (r.correct) onDone();
              } catch (e) {
                setErr(copyFor(e));
              }
            }}
            className={`text-left flex items-center gap-3 rounded-[8px] border bg-surface px-4 py-[9px] text-[12.5px] text-ink-2 ${focusRing} ${tone}`}
          >
            <span className={`size-[12px] rounded-full border ${chosen && res?.correct ? "bg-ready border-ready" : "border-line-strong"}`} />
            <Tex html={o.html} />
          </button>
        );
      })}
      {res?.feedbackHtml ? <Tex as="p" className={`text-[12px] ${res.correct ? "text-ready" : "text-working"}`} html={`${res.correct ? "✓ " : ""}${res.feedbackHtml}`} /> : null}
      {err ? <p className="text-[11px] text-red">{err}</p> : null}
    </fieldset>
  );
}

function AnswerBox({ onSubmit, label, again, disabled }: { onSubmit: (raw: string) => Promise<void>; label: string; again: boolean; disabled?: boolean }) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex items-center gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!raw.trim()) return;
        setBusy(true);
        await onSubmit(raw).finally(() => setBusy(false));
      }}
    >
      <input
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        disabled={disabled}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        className={`w-[220px] bg-inset border rounded-[8px] px-4 py-[11px] font-mono text-[15px] text-ink ${again ? "border-working" : "border-line-strong"} ${focusRing}`}
      />
      <Button type="submit" loading={busy} disabled={disabled}>
        {again ? "Check again" : "Check"}
      </Button>
    </form>
  );
}

function HintsAndSolution({ url, part, total, solutionAvailable, onRevealed }: { url: string; part?: number; total: number; solutionAvailable: boolean; onRevealed?: () => void }) {
  const [hints, setHints] = useState<string[]>([]);
  const [solution, setSolution] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      {hints.map((h, i) => (
        <div key={i} className="border border-blue/60 bg-blue/5 rounded-[10px] px-4 py-3">
          <span className="font-mono text-[8.5px] tracking-[0.14em] text-blue">HINT {i + 1} OF {total}</span>
          <Tex as="p" className="text-[13px] text-ink mt-1" html={h} />
        </div>
      ))}
      {solution ? (
        <div className="border border-line-strong bg-surface rounded-[10px] px-4 py-3">
          <Label>Solution</Label>
          <Tex as="div" className="text-[13px] leading-[21px] text-ink-2 mt-1" html={solution} />
          <p className="text-[10.5px] text-ink-3 mt-2">Now enter the answer yourself to continue — typing it is part of learning it.</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        {hints.length < total ? (
          <Button
            kind="secondary"
            onClick={async () => {
              try {
                const r = await call<{ html: string }>(`${url}/hint`, { json: { index: hints.length, part } });
                setHints((h) => [...h, r.html]);
              } catch (e) {
                setErr(copyFor(e));
              }
            }}
          >
            Show hint {hints.length + 1}
          </Button>
        ) : null}
        {!solution && (solutionAvailable || hints.length >= total) ? (
          <Button
            kind="ghost"
            onClick={async () => {
              try {
                const r = await call<{ html: string }>(`${url}/reveal`, { json: { part } });
                setSolution(r.html);
                onRevealed?.();
              } catch (e) {
                setErr(copyFor(e));
              }
            }}
          >
            Show me the solution
          </Button>
        ) : null}
      </div>
      {err ? <p className="text-[11px] text-red">{err}</p> : null}
    </>
  );
}

function Check({ step, url, onSolved }: { step: ClientStep; url: string; onSolved: () => void }) {
  const [res, setRes] = useState<Attempt | null>(step.solved ? { correct: true, feedbackHtml: null, hintsRemaining: 0, solutionAvailable: false, solutionHtml: null, firstTry: !!step.firstTry } : null);
  const [tries, setTries] = useState(step.attempted ? 1 : 0);
  const [firstTry, setFirstTry] = useState<boolean | null>(step.attempted ? !!step.firstTry : null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const solved = res?.correct;

  async function attempt(raw: string) {
    setErr(null);
    try {
      const r = await call<Attempt>(`${url}/attempt`, { json: { raw } });
      setRes(r);
      if (firstTry === null) setFirstTry(r.firstTry);
      setTries((t) => t + 1);
      if (r.correct) onSolved();
    } catch (e) {
      setErr(copyFor(e));
    }
  }

  return (
    <>
      <div className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-4">
        <Tex as="p" className="text-[16px] leading-[25px] text-ink" html={step.stemHtml ?? ""} />
        {step.kind === "mcq" ? (
          <div className="flex flex-col gap-2" role="radiogroup">
            {(step.options ?? []).map((o) => {
              const chosen = picked === o.id;
              const tone = chosen && res ? (res.correct ? "border-ready bg-ready/10" : "border-working bg-working/5") : "border-line hover:border-line-strong";
              return (
                <button
                  key={o.id}
                  role="radio"
                  aria-checked={chosen}
                  disabled={!!solved}
                  onClick={() => {
                    setPicked(o.id);
                    void attempt(o.id);
                  }}
                  className={`text-left flex items-center gap-3 rounded-[8px] border bg-inset px-4 py-[10px] text-[13px] text-ink-2 ${focusRing} ${tone}`}
                >
                  <span className="font-mono text-[11px] text-ink-3 w-4">{o.id}</span>
                  <Tex html={o.html} />
                </button>
              );
            })}
          </div>
        ) : (
          <AnswerBox onSubmit={attempt} label="Your answer" again={!!res && !res.correct} disabled={!!solved} />
        )}
        {err ? <p className="text-[11.5px] text-red" role="alert">{err}</p> : null}
        {res && !res.correct ? (
          <div className="border-l-2 border-working bg-working/5 rounded-[6px] px-4 py-3" role="status">
            <span className="font-mono text-[8.5px] tracking-[0.14em] text-working">NOT QUITE — TRY AGAIN</span>
            {res.feedbackHtml ? <Tex as="p" className="text-[12.5px] text-ink-2 mt-1" html={res.feedbackHtml} /> : <p className="text-[12.5px] text-ink-2 mt-1">Check your working — or open a hint. Nothing here is scored.</p>}
          </div>
        ) : null}
        {solved ? (
          <div className="border-l-2 border-ready bg-ready/5 rounded-[6px] px-4 py-3" role="status">
            <span className="font-mono text-[8.5px] tracking-[0.14em] text-ready">RIGHT</span>
            {res?.solutionHtml ? <Tex as="div" className="text-[12.5px] leading-[20px] text-ink-2 mt-1" html={res.solutionHtml} /> : null}
          </div>
        ) : null}
      </div>
      {!solved && tries > 0 ? <HintsAndSolution url={url} total={step.hints ?? 0} solutionAvailable={!!res?.solutionAvailable} /> : null}
      {firstTry !== null ? (
        <p className="bg-surface rounded-[6px] px-4 py-2 text-[11px] text-ink-3 flex gap-3">
          <span className={`font-mono ${firstTry ? "text-ready" : "text-working"}`}>first try {firstTry ? "✓" : "✗"}</span>
          {firstTry ? "Good. First tries decide which difficulty band your practice starts at." : "That is fine. First tries only decide which difficulty band your practice starts at — nothing else."}
        </p>
      ) : null}
    </>
  );
}

function Faded({ step, url, onSolved }: { step: ClientStep; url: string; onSolved: (key: string) => void }) {
  const rows = step.steps ?? [];
  return (
    <>
      <Problem html={step.problemHtml ?? ""} />
      <ol className="flex flex-col gap-4">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-4">
            <Num n={i + 1} />
            <div className="flex-1">
              {"blank" in r && r.blank ? <Blank url={url} row={r} onSolved={() => onSolved(`${step.id}#${r.index}`)} /> : <Tex as="div" className="prose-qa [&_p]:mb-0 text-[13.5px]" html={(r as { html: string }).html} />}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function Blank({ url, row, onSolved }: { url: string; row: { index: number; promptHtml: string; hints: number; solved: boolean }; onSolved: () => void }) {
  const [res, setRes] = useState<Attempt | null>(row.solved ? ({ correct: true } as Attempt) : null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border border-dashed border-line-strong rounded-[10px] p-4 flex flex-col gap-3">
      <span className="font-mono text-[8.5px] tracking-[0.14em] text-working">YOUR TURN</span>
      <Tex as="p" className="text-[13.5px] text-ink" html={row.promptHtml} />
      {res?.correct ? (
        <p className="text-[12px] text-ready">✓ Right.</p>
      ) : (
        <>
          <AnswerBox
            label="Fill the blank"
            again={!!res}
            onSubmit={async (raw) => {
              setErr(null);
              try {
                const r = await call<Attempt>(`${url}/attempt`, { json: { raw, part: row.index } });
                setRes(r);
                if (r.correct) onSolved();
              } catch (e) {
                setErr(copyFor(e));
              }
            }}
          />
          {res && !res.correct ? <p className="text-[12px] text-working">Not quite — try again.</p> : null}
          {err ? <p className="text-[11px] text-red">{err}</p> : null}
          {res ? <HintsAndSolution url={url} part={row.index} total={row.hints} solutionAvailable={!!res.solutionAvailable} /> : null}
        </>
      )}
    </div>
  );
}

function Trap({ step, url }: { step: ClientStep; url: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [res, setRes] = useState<Attempt | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const found = res?.correct;
  return (
    <>
      <Tex as="p" className="text-[14px] leading-[22px] text-ink-2" html={step.promptHtml ?? ""} />
      <p className="text-[12px] text-ink-3">One step below is wrong. Click it.</p>
      <ol className="flex flex-col gap-2">
        {(step.flawed ?? []).map((h, i) => {
          const chosen = picked === i;
          const tone = chosen && res ? (res.correct ? "border-red bg-red/10" : "border-line-strong opacity-70") : "border-line hover:border-line-strong";
          return (
            <li key={i}>
              <button
                disabled={!!found}
                onClick={async () => {
                  setPicked(i);
                  setErr(null);
                  try {
                    setRes(await call<Attempt>(`${url}/attempt`, { json: { raw: String(i) } }));
                  } catch (e) {
                    setErr(copyFor(e));
                  }
                }}
                className={`w-full text-left flex gap-4 items-start rounded-[8px] border bg-surface px-4 py-3 text-[13px] text-ink-2 ${focusRing} ${tone}`}
              >
                <Num n={i + 1} />
                <Tex html={h} />
              </button>
            </li>
          );
        })}
      </ol>
      {res && !res.correct && res.feedbackHtml ? <Tex as="p" className="text-[12.5px] text-working" html={res.feedbackHtml} /> : null}
      {res?.explanationHtml || reveal ? (
        <div className="border-l-2 border-red bg-surface rounded-[6px] px-4 py-3">
          <Label color="var(--accent-red)">{found ? "Found it" : "The flaw"}</Label>
          <Tex as="p" className="text-[12.5px] leading-[20px] text-ink-2 mt-1" html={res?.explanationHtml || reveal || ""} />
        </div>
      ) : res && !found ? (
        <div>
          <Button
            kind="ghost"
            onClick={async () => {
              try {
                setReveal((await call<{ html: string }>(`${url}/reveal`, { json: {} })).html);
              } catch (e) {
                setErr(copyFor(e));
              }
            }}
          >
            Show me the flaw
          </Button>
        </div>
      ) : null}
      {err ? <p className="text-[11px] text-red">{err}</p> : null}
    </>
  );
}

function FlagStep({ base, stepId }: { base: string; stepId: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const note = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setOpen(false);
    setSent(false);
  }, [stepId]);
  if (sent) return <span className="text-[11px] text-ink-3">Thanks — a reviewer will look at this step.</span>;
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className={`text-[11px] text-ink-3 hover:text-ink rounded ${focusRing}`}>
        ⚑ Something wrong with this step?
      </button>
    );
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await call(`${base}/steps/${encodeURIComponent(stepId)}/flag`, { json: { note: note.current?.value || null } }).catch(() => {});
        setSent(true);
      }}
    >
      <textarea ref={note} rows={1} maxLength={2000} placeholder="What looks wrong?" aria-label="What looks wrong?" className={`w-[240px] bg-inset border border-line rounded-[6px] px-2 py-1 text-[11.5px] ${focusRing}`} />
      <Button size="sm" kind="secondary" type="submit">Send</Button>
    </form>
  );
}

function Complete({ lesson, done, sessionId, next }: { lesson: LessonData; done: Done; sessionId: string | null; next: { id: string; name: string; minutes: number } | null }) {
  const checks = lesson.steps.filter((s) => s.type === "check").length;
  const right = Math.round(done.firstTryRate * checks);
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[860px] flex flex-col gap-5">
        <div className="text-center flex flex-col items-center gap-3">
          <span className="label">Learning path complete · {lesson.steps.length} steps · {lesson.estMinutes} min</span>
          <h1 className="text-[30px] font-semibold tracking-[-0.01em]">{lesson.skillName} — learned.</h1>
          <div className="flex items-center gap-3">
            <Chip>{LEVELS[done.levelBefore]}</Chip>
            <span className="text-ink-3">→</span>
            <Chip className="bg-elevated">{LEVELS[done.levelAfter]}{done.levelAfter === 1 ? " · learned" : ""}</Chip>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="checks right first time" value={checks ? `${right} of ${checks}` : "—"} color={right === checks ? "var(--level-ready)" : "var(--level-working)"} />
          <Metric label="practice starts at" value={`band ${done.entryBand}`} color="var(--text-secondary)" />
          <Metric label="misconceptions covered" value={String(lesson.misconceptionsCovered)} color="var(--level-ready)" />
        </div>
        {lesson.keyResultsHtml.length ? (
          <div className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-3">
            <Label>Key results · saved to your review sheet</Label>
            {lesson.keyResultsHtml.map((h, i) => (
              <Tex key={i} as="div" html={h} className="text-[13px] leading-[21px] text-ink-2" />
            ))}
          </div>
        ) : null}
        <div className="bg-surface border-l-2 border-blue rounded-[8px] px-5 py-4">
          <Label color="var(--accent-blue)">Now prove it</Label>
          <p className="text-[13px] leading-[21px] text-ink-2 mt-1">
            Familiar means you have learned it. Working and Interview-ready mean you have proved it — cold, on questions you have never seen, against the clock. That is what practice is for, and it is what your readiness score is built from.
          </p>
        </div>
        {sessionId ? (
          <ButtonLink href={`/session/${sessionId}`} size="lg">Back to your session →</ButtonLink>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {next ? (
              <ButtonLink href={`/learn/${encodeURIComponent(next.id)}`} kind="secondary" size="lg">
                Next lesson: {next.name} · {next.minutes} min
              </ButtonLink>
            ) : (
              <Link href="/learn" className={btnClass("secondary", "lg")}>Back to Learn</Link>
            )}
            <StartSession skillId={lesson.skillId} size="lg">
              Practise {lesson.skillName.toLowerCase()} · 8 items
            </StartSession>
          </div>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }): ReactNode {
  return (
    <div className="bg-surface border border-line rounded-[10px] px-4 py-3">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="font-mono text-[18px] mt-1" style={{ color }}>{value}</p>
    </div>
  );
}

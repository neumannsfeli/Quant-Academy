"use client";

/**
 * The session runner (frames 04, 05, 14, 15, 16 and the runner edge states).
 *
 * The server owns the clock: the countdown shown here starts from the server's
 * measured elapsed time and is advisory. It never shifts layout when a verdict
 * renders (tech spec §13), and it is usable from the keyboard alone.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, call, copyFor } from "@/lib/client";
import { mmss } from "@/lib/format";
import { Button, Chip, Label, Tex, btnClass, focusRing } from "../ui";
import { readsAs } from "./reads-as";

type ClientItem = {
  type: "numeric" | "mcq" | "symbolic" | "multistep" | "drill";
  band: number;
  stemHtml: string;
  timeLimitSec: number;
  options?: { id: string; html: string }[];
  variables?: string[];
  checkpoints?: { index: number; prompt: string; kind: string; variables?: string[]; html: string }[];
  drill?: { count: number; totalSec: number; items: { index: number; html: string }[] };
};

type Served = {
  done: false;
  kind: "item";
  sessionId: string;
  sessionItemId: string;
  mode: string;
  position: number;
  total: number;
  skillId: string;
  skillName: string;
  domainName: string;
  seed: number;
  unseen: boolean;
  elapsedMs: number;
  status: string;
  item: ClientItem;
  progress: { checkpoints?: CheckpointResult[]; total?: number; drill?: { correct: boolean }[] } | null;
  history: { status: string; ok: boolean | null }[];
};
type LessonSlot = { done: false; kind: "lesson" | "refresher"; sessionId: string; sessionItemId: string; skillId: string; skillName: string; position: number; total: number; misconceptionId: string | null };
type Next = { done: true; sessionId: string } | Served | LessonSlot;
type CheckpointResult = { raw: string; correct: boolean; carried: boolean; display: string; answerDisplay: string };

export type Verdict = {
  status: "correct" | "incorrect" | "timeout" | "voided" | "recorded";
  mode: string;
  submitted: string | null;
  correctHtml: string;
  misconception: { id: string; label: string; explanationHtml: string } | null;
  review: { skillId: string; stepId: string; stepNumber: number; lessonTitle: string } | null;
  solutionHtml: string[];
  deltas: { theta: [number, number]; coldStreak: [number, number]; b: [number, number]; level: [number, number] } | null;
  elapsedMs: number;
  timeLimitSec: number;
  partial?: { correct: number; total: number };
  withheld?: boolean;
};

const TYPE_LABEL: Record<ClientItem["type"], string> = { numeric: "Numeric", mcq: "MCQ · named distractors", symbolic: "Symbolic", multistep: "Multi-step", drill: "Timed drill" };
const LEVELS = ["Unseen", "Familiar", "Working", "Interview-ready"];

export function SessionRunner({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [next, setNext] = useState<Next | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<{ retry: () => void } | null>(null);
  const [ending, setEnding] = useState(false);
  const loadedAt = useRef(0);

  const finish = useCallback(async () => {
    setEnding(true);
    try {
      await call(`/api/sessions/${sessionId}/end`, { method: "POST" });
    } finally {
      router.replace(`/session/${sessionId}/summary`);
    }
  }, [router, sessionId]);

  const load = useCallback(async () => {
    setError(null);
    setVerdict(null);
    try {
      const n = await call<Next>(`/api/sessions/${sessionId}/next`, { method: "POST" });
      loadedAt.current = performance.now();
      if (n.done) return finish();
      setNext(n);
    } catch (e) {
      if (e instanceof ApiFailure) setError(copyFor(e));
      else setOffline({ retry: () => void load().then(() => setOffline(null)) });
    }
  }, [finish, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (ending) return <Shell title="Finishing…" />;
  if (error) return <Shell title="Session"><div className="max-w-[520px] mx-auto mt-40 text-center text-ink-2">{error} <Link className="underline" href="/home">Back to home</Link></div></Shell>;
  if (!next) return <Shell title="Loading…"><RunnerSkeleton /></Shell>;
  if (next.done) return <Shell title="Finishing…" />;

  if (next.kind !== "item") return <LessonInterstitial slot={next} onSkip={load} />;

  return (
    <ItemView
      key={next.sessionItemId}
      served={next}
      loadedAt={loadedAt.current}
      verdict={verdict}
      onVerdict={setVerdict}
      onNext={load}
      onEnd={finish}
      offline={offline}
      setOffline={setOffline}
    />
  );
}

function modeTitle(mode: string, type?: string) {
  if (type === "drill") return "Mental math drill";
  return mode === "placement" ? "Placement" : mode === "assessment" ? "Assessment" : mode === "review" ? "Review session" : "Practice session";
}

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="h-[62px] bg-surface border-b border-line flex items-center px-7">
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

function RunnerSkeleton() {
  return (
    <div className="max-w-[780px] mx-auto mt-[260px] flex flex-col items-center gap-4" aria-busy>
      <div className="h-6 w-60 bg-elevated rounded animate-pulse" />
      <div className="h-8 w-[520px] bg-elevated rounded animate-pulse" />
      <div className="h-14 w-[320px] bg-elevated rounded-[10px] animate-pulse mt-4" />
    </div>
  );
}

function ProgressDashes({ history, total, position }: { history: { status: string; ok: boolean | null }[]; total: number; position: number }) {
  const cells = Array.from({ length: Math.max(total, history.length) }, (_, i) => {
    const h = history[i];
    if (i === position && (!h || h.status === "served")) return "bg-blue";
    if (!h) return "bg-line";
    if (h.status === "ungraded" || h.status === "skipped") return "bg-line-strong";
    if (h.status === "done") return "bg-ready";
    if (h.ok === true) return "bg-ready";
    if (h.ok === false) return "bg-red";
    return "bg-line";
  });
  return (
    <div className="flex gap-[5px] mt-[6px]" aria-hidden>
      {cells.slice(0, 40).map((c, i) => (
        <span key={i} className={`h-[3px] w-[10px] rounded-full ${c}`} />
      ))}
    </div>
  );
}

function TopBar({ served, remainingMs, limitMs, answered, verdict, onEnd, subtitle }: { served: Served; remainingMs: number; limitMs: number; answered: boolean; verdict: Verdict | null; onEnd: () => void; subtitle?: string }) {
  const low = remainingMs <= 20_000;
  const frac = limitMs ? Math.max(0, Math.min(1, remainingMs / limitMs)) : 0;
  return (
    <header className="h-[62px] bg-surface border-b border-line grid grid-cols-3 items-center px-7">
      <div>
        <div className="flex items-baseline gap-[10px]">
          <span className="text-[13px] font-semibold">{modeTitle(served.mode, served.item.type)}</span>
          <span className="font-mono text-[10px] text-ink-3">{subtitle ?? `item ${served.position + 1} of ${Math.max(served.total, served.position + 1)}`}</span>
        </div>
        <ProgressDashes history={served.history} total={served.total} position={served.position} />
      </div>
      <div className="flex flex-col items-center" aria-live="off">
        {answered && verdict ? (
          <>
            <span className="font-mono text-[20px] font-semibold text-ink-3">{mmss(verdict.elapsedMs)}</span>
            <span className="h-[3px] w-[62px] rounded-full bg-line-strong my-[3px]" />
            <span className="font-mono text-[9px] text-ink-3">time taken</span>
          </>
        ) : (
          <>
            <span className={`font-mono text-[20px] font-semibold ${low ? "text-red" : "text-working"}`} role="timer" aria-label={`${Math.ceil(remainingMs / 1000)} seconds left`}>
              {mmss(remainingMs)}
            </span>
            <span className="h-[3px] w-[62px] rounded-full bg-line my-[3px] overflow-hidden">
              <span className={`block h-full ${low ? "bg-red" : "bg-working"}`} style={{ width: `${frac * 100}%` }} />
            </span>
            <span className="font-mono text-[9px] text-ink-3">of {mmss(limitMs)} {served.item.type === "drill" ? "· whole set" : "limit"}</span>
          </>
        )}
      </div>
      <div className="flex justify-end items-center gap-3">
        <span className="bg-inset rounded-[6px] px-3 py-[7px] font-mono text-[8.5px] tracking-[0.1em] text-ink-3">
          MODE <span className="text-ink-2 ml-1">{served.mode === "assessment" ? "ASSESSMENT" : served.mode === "placement" ? "PLACEMENT" : "PRACTICE"}</span>
        </span>
        <button onClick={onEnd} className={btnClass("secondary", "sm", "!px-4 !py-2 !text-[12.5px]")}>End session</button>
      </div>
    </header>
  );
}

function useCountdown(limitMs: number, startElapsedMs: number, loadedAt: number, frozen: boolean) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (frozen) return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [frozen]);
  const elapsed = startElapsedMs + (now - loadedAt);
  return { remaining: Math.max(0, limitMs - elapsed), elapsed };
}

function ItemView({ served, loadedAt, verdict, onVerdict, onNext, onEnd, offline, setOffline }: {
  served: Served;
  loadedAt: number;
  verdict: Verdict | null;
  onVerdict: (v: Verdict) => void;
  onNext: () => void;
  onEnd: () => void;
  offline: { retry: () => void } | null;
  setOffline: (o: { retry: () => void } | null) => void;
}) {
  const item = served.item;
  const limitMs = (item.drill?.totalSec ?? item.timeLimitSec) * 1000;
  const [submitting, setSubmitting] = useState(false);
  const { remaining, elapsed } = useCountdown(limitMs, served.elapsedMs, loadedAt, !!verdict);
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const autoSubmitted = useRef(false);
  const pending = useRef<string>("");
  const setPending = useCallback((r: string) => {
    pending.current = r;
  }, []);

  const submit = useCallback(
    async (raw: string, attempt = 0): Promise<void> => {
      setSubmitting(true);
      setInputError(null);
      try {
        const v = await call<Verdict>(`/api/session-items/${served.sessionItemId}/answer`, { json: { raw, clientElapsedMs: Math.round(elapsed) } });
        setOffline(null);
        if (v.status === "recorded") return onNext(); // assessment: solutions after the whole test
        onVerdict(v);
      } catch (e) {
        if (e instanceof ApiFailure) {
          if (e.error.code === "ITEM_GRADING" && attempt < 5) {
            await new Promise((r) => setTimeout(r, 600));
            return submit(raw, attempt + 1);
          }
          if (["NOT_A_NUMBER", "PARSE_ERROR", "VALIDATION"].includes(e.error.code)) setInputError(e.error.code === "PARSE_ERROR" ? `not an expression we can read${e.error.message ? ` — ${e.error.message}` : ""}` : "not a number");
          else setInputError(copyFor(e));
        } else {
          // §13.2: hold the answer locally and retry; the item is not scored until the server confirms.
          setOffline({ retry: () => void submit(raw, 0) });
          if (attempt < 4) setTimeout(() => void submit(raw, attempt + 1), 1500 * 2 ** attempt);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [elapsed, onNext, onVerdict, served.sessionItemId, setOffline],
  );

  // At zero, submit whatever is typed: the server scores it as a timeout if it is past the grace.
  useEffect(() => {
    if (verdict || autoSubmitted.current || remaining > 0 || item.type === "multistep") return;
    autoSubmitted.current = true;
    void submit(pending.current);
  }, [remaining, verdict, submit, item.type]);

  useEffect(() => {
    if (!verdict) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [verdict, onNext]);

  const chips = (
    <div className="flex items-center justify-center gap-2">
      <Chip tone="blue">{TYPE_LABEL[item.type]}</Chip>
      <Chip>Band {item.band}</Chip>
      {item.type === "drill" ? <Chip tone="amber">{item.drill?.count} items · one clock</Chip> : item.type === "symbolic" ? <Chip tone="amber">Graded by SymPy</Chip> : served.unseen ? <Chip tone="green">Unseen seed · {served.seed}</Chip> : <Chip tone="amber">Repeat · no mastery credit</Chip>}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar served={served} remainingMs={remaining} limitMs={limitMs} answered={!!verdict} verdict={verdict} onEnd={() => setConfirmEnd(true)} subtitle={item.type === "drill" ? `set of ${item.drill?.count}` : undefined} />
      {confirmEnd ? (
        <div className="bg-inset border-b border-line px-7 py-3 flex items-center justify-between text-[12px]">
          <span className="text-ink-2">End the session now? Answered items are saved; an open item is scored as a timeout.</span>
          <span className="flex gap-2">
            <Button size="sm" kind="secondary" onClick={() => setConfirmEnd(false)}>Keep going</Button>
            <Button size="sm" onClick={onEnd}>End session</Button>
          </span>
        </div>
      ) : null}
      {offline ? (
        <div role="alert" className="bg-red/10 border-b border-red/40 px-7 py-3 flex items-center justify-between text-[12px]">
          <span className="text-red">Connection lost — your answer has not been sent. We are still retrying; nothing is lost, and the item is not scored until the server confirms it.</span>
          <Button size="sm" onClick={offline.retry}>Retry now</Button>
        </div>
      ) : null}

      <main className="flex-1 flex flex-col items-center px-6 pt-[120px] pb-16">
        {verdict ? (
          <VerdictView verdict={verdict} served={served} onNext={onNext} />
        ) : item.type === "multistep" ? (
          <MultiStep served={served} chips={chips} onVerdict={onVerdict} />
        ) : item.type === "drill" ? (
          <Drill served={served} chips={chips} onVerdict={onVerdict} remaining={remaining} onRaw={setPending} />
        ) : (
          <SingleAnswer served={served} chips={chips} submitting={submitting} inputError={inputError} onSubmit={(raw) => submit(raw)} onRaw={setPending} />
        )}
      </main>
    </div>
  );
}

function StemBlock({ served, chips }: { served: Served; chips: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-[14px] max-w-[780px] text-center">
      {chips}
      <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink-3">
        {served.domainName.split(" & ")[0]} · {served.skillName.toLowerCase()}
      </p>
      <Tex as="h1" html={served.item.stemHtml} className="text-[26px] leading-[34px] font-semibold text-ink" />
    </div>
  );
}

function SingleAnswer({ served, chips, submitting, inputError, onSubmit, onRaw }: { served: Served; chips: React.ReactNode; submitting: boolean; inputError: string | null; onSubmit: (raw: string) => void; onRaw: (r: string) => void }) {
  const item = served.item;
  const [raw, setRaw] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const preview = useMemo(() => (item.type === "symbolic" ? readsAs(raw, item.variables ?? []) : null), [raw, item.type, item.variables]);
  const value = item.type === "mcq" ? choice ?? "" : raw;
  useEffect(() => {
    onRaw(value);
  }, [value, onRaw]);

  useEffect(() => {
    if (item.type !== "mcq") return;
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < (item.options?.length ?? 0)) setChoice(item.options![idx]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item]);

  return (
    <form
      className="flex flex-col items-center gap-6 w-full"
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) onSubmit(value);
      }}
    >
      <StemBlock served={served} chips={chips} />
      {item.type === "mcq" ? (
        <fieldset className="w-full max-w-[540px] flex flex-col gap-3" aria-label="Options">
          {item.options!.map((o, i) => (
            <label key={o.id} className={`flex items-center gap-3 px-4 py-3 rounded-[8px] border cursor-pointer text-[13px] ${choice === o.id ? "border-blue bg-blue/10 text-ink" : "border-line bg-inset text-ink-2 hover:border-line-strong"} ${focusRing}`}>
              <input type="radio" name="opt" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} className="accent-[var(--accent-blue)] size-4" aria-keyshortcuts={String(i + 1)} />
              <Tex html={o.html} />
            </label>
          ))}
        </fieldset>
      ) : (
        <div className={`flex flex-col items-center gap-3 w-full ${item.type === "symbolic" ? "max-w-[540px]" : "max-w-[320px]"}`}>
          <input
            ref={inputRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            aria-label="Your answer"
            aria-invalid={!!inputError}
            autoComplete="off"
            spellCheck={false}
            placeholder="your answer"
            className={`w-full h-[58px] rounded-[10px] bg-surface border px-5 font-mono text-[20px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-[3px] focus:ring-blue/55 ${inputError ? "border-red text-red" : "border-blue"}`}
          />
          {inputError ? <p className="font-mono text-[10.5px] text-red" role="alert">{inputError}</p> : null}
          {item.type === "symbolic" ? (
            <>
              <div className="w-full bg-inset rounded-[8px] px-4 py-3 flex items-center gap-3 min-h-[42px]">
                <span className="font-mono text-[9.5px] text-ink-3">reads as</span>
                {preview?.ok ? <span className="font-mono text-[14px] text-ready" dangerouslySetInnerHTML={{ __html: preview.html }} /> : <span className="font-mono text-[11px] text-ink-3">{preview?.message}</span>}
              </div>
              <p className="font-mono text-[9.5px] text-ink-3 self-start">variables in scope: {(item.variables ?? []).join(", ")} · ^ for powers, * for products</p>
            </>
          ) : (
            <p className="font-mono text-[9.5px] text-ink-3">exact fraction or decimal · expressions like 27/4 are fine</p>
          )}
        </div>
      )}
      <Button type="submit" size="lg" loading={submitting} className="min-w-[200px]">Submit answer</Button>
      <p className="text-[11px] text-ink-3">No hints. No going back. Interview-ready is only granted on unseen seeds, inside the limit.</p>
    </form>
  );
}

function MultiStep({ served, chips, onVerdict }: { served: Served; chips: React.ReactNode; onVerdict: (v: Verdict) => void }) {
  const total = served.progress?.total ?? 2;
  const [results, setResults] = useState<CheckpointResult[]>(served.progress?.checkpoints ?? []);
  const [prompts, setPrompts] = useState(served.item.checkpoints ?? []);
  const [reveal, setReveal] = useState<{ answerHtml: string; yours: string; index: number } | null>(null);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = results.length;
  const cp = prompts[current];
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [current]);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ done: true; verdict: Verdict } | { done: false; index: number; correct: boolean; reveal: { answerHtml: string; yours: string } | null; next: { index: number; prompt: string; kind: string; html: string } | null }>(`/api/session-items/${served.sessionItemId}/step`, { json: { index: current, raw } });
      if (r.done) return onVerdict(r.verdict);
      setResults((rs) => [...rs, { raw, correct: r.correct, carried: !r.correct, display: raw, answerDisplay: "" }]);
      setReveal(r.reveal ? { ...r.reveal, index: current } : null);
      if (r.next) setPrompts((p) => [...p.slice(0, r.next!.index), r.next!]);
      setRaw("");
    } catch (e) {
      setErr(e instanceof ApiFailure && ["NOT_A_NUMBER", "PARSE_ERROR"].includes(e.error.code) ? "not a number" : copyFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[820px] flex flex-col gap-5 -mt-[60px]">
      <div className="flex gap-2">{chips}</div>
      <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink-3">{served.domainName.split(" & ")[0]} · {served.skillName.toLowerCase()}</p>
      <Tex as="h1" html={served.item.stemHtml} className="text-[22px] leading-[31px] font-semibold" />
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {Array.from({ length: total }, (_, i) => {
          const r = results[i];
          const state = r ? (r.correct ? "done" : "carried") : i === current ? "answering" : "todo";
          const cls = state === "done" ? "border-ready" : state === "carried" ? "border-working" : state === "answering" ? "border-blue bg-blue/5" : "border-line opacity-70";
          return (
            <div key={i} className={`border rounded-[8px] px-3 py-3 min-h-[54px] ${cls}`}>
              <div className="flex justify-between font-mono text-[9px]">
                <span className={state === "done" ? "text-ready" : state === "carried" ? "text-working" : state === "answering" ? "text-blue" : "text-ink-3"}>STEP {i + 1}</span>
                <span className={state === "done" ? "text-ready" : "text-working"}>{state === "done" ? "✓" : state === "carried" ? "carried" : state === "answering" ? <span className="text-blue">answering</span> : ""}</span>
              </div>
              <p className="text-[11px] text-ink-2 mt-1 line-clamp-2">{prompts[i]?.prompt.replace(/\$[^$]*\$/g, "…") ?? "—"}</p>
            </div>
          );
        })}
      </div>
      {reveal ? (
        <div className="bg-inset border-l-2 border-working rounded-[8px] px-5 py-4">
          <Label color="var(--level-working)">Step {reveal.index + 1} — wrong, carried forward</Label>
          <p className="text-[12px] text-ink-2 mt-2">
            you answered <s className="font-mono">{reveal.yours}</s> · <span className="font-mono text-working">correct <Tex html={reveal.answerHtml} /></span>
          </p>
          <p className="text-[11px] text-ink-3 mt-1">The correct value has been carried into the next step so one slip does not cost you the rest of the problem. This step still counts as wrong.</p>
        </div>
      ) : null}
      {cp ? (
        <form
          className="bg-surface border border-line rounded-[10px] p-7 flex flex-col items-center gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void send();
          }}
        >
          <Label color="var(--accent-blue)">Step {current + 1} of {total}</Label>
          <Tex as="p" html={cp.html} className="text-[18px] leading-[26px] font-semibold text-center max-w-[520px]" />
          <input ref={inputRef} value={raw} onChange={(e) => setRaw(e.target.value)} aria-label={`Step ${current + 1} answer`} autoComplete="off" className={`w-[300px] h-[54px] rounded-[10px] bg-inset border px-5 font-mono text-[18px] focus:outline-none focus:ring-[3px] focus:ring-blue/55 ${err ? "border-red" : "border-blue"}`} />
          {err ? <p className="font-mono text-[10.5px] text-red">{err}</p> : null}
          <Button type="submit" loading={busy}>Submit step {current + 1}</Button>
        </form>
      ) : null}
      <p className="text-[11px] text-ink-3 text-center">Partial credit counts toward your ability estimate. Interview-ready needs all {total} steps correct, unaided, inside the limit.</p>
    </div>
  );
}

function Drill({ served, chips, onVerdict, remaining, onRaw }: { served: Served; chips: React.ReactNode; onVerdict: (v: Verdict) => void; remaining: number; onRaw: (r: string) => void }) {
  const drill = served.item.drill!;
  const [results, setResults] = useState<boolean[]>((served.progress?.drill ?? []).map((d) => d.correct));
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [times, setTimes] = useState<number[]>([]);
  const shownAt = useRef(performance.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const i = results.length;
  useEffect(() => {
    inputRef.current?.focus();
    shownAt.current = performance.now();
  }, [i]);
  useEffect(() => {
    onRaw("");
  }, [onRaw]);
  const passMark = Math.ceil(drill.count * 0.8);

  async function send(value: string) {
    setBusy(true);
    try {
      const r = await call<{ done: true; verdict: Verdict } | { done: false; correct: boolean }>(`/api/session-items/${served.sessionItemId}/step`, { json: { index: i, raw: value } });
      setTimes((t) => [...t, performance.now() - shownAt.current]);
      if (r.done) return onVerdict(r.verdict);
      setResults((rs) => [...rs, r.correct]);
      setRaw("");
    } catch (e) {
      if (e instanceof ApiFailure && e.error.code === "ITEM_NOT_OPEN") {
        const v = await call<Verdict>(`/api/session-items/${served.sessionItemId}/answer`, { json: { raw: "", clientElapsedMs: null } });
        onVerdict(v);
      }
    } finally {
      setBusy(false);
    }
  }

  const item = drill.items[i];
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-[720px] -mt-[20px]">
      {chips}
      <div className="flex gap-[5px]" aria-label={`${results.length} of ${drill.count} answered`}>
        {Array.from({ length: drill.count }, (_, k) => (
          <span key={k} className={`h-[5px] w-[21px] rounded-full ${k < results.length ? (results[k] ? "bg-ready" : "bg-red") : k === i ? "bg-blue" : "bg-line"}`} />
        ))}
      </div>
      <p className="font-mono text-[10.5px] tracking-[0.08em] text-ink-3">{served.domainName} · {served.skillName.toLowerCase()}</p>
      <Tex as="p" html={served.item.stemHtml} className="text-[12px] text-ink-3 -mt-3" />
      {item ? <Tex as="p" html={item.html} className="font-mono text-[52px] font-bold tracking-tight text-ink" /> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && item) void send(raw);
        }}
        className="flex flex-col items-center gap-3"
      >
        <input ref={inputRef} value={raw} onChange={(e) => setRaw(e.target.value)} disabled={remaining <= 0} aria-label="Answer" autoComplete="off" inputMode="decimal" className="w-[260px] h-[56px] rounded-[10px] bg-surface border border-blue px-5 font-mono text-[20px] focus:outline-none focus:ring-[3px] focus:ring-blue/55" />
        <p className="font-mono text-[10px] text-ink-3">press ↵ for the next one · no going back</p>
      </form>
      <div className="w-full border border-line rounded-[10px] bg-inset grid grid-cols-4 py-3 text-center">
        <Stat label="answered" value={`${results.length} / ${drill.count}`} />
        <Stat label="correct" value={String(results.filter(Boolean).length)} color="text-ready" />
        <Stat label="avg time" value={times.length ? `${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1)}s` : "—"} color="text-ink-2" />
        <Stat label="pass mark" value={`${passMark} / ${drill.count}`} color="text-working" />
      </div>
      <p className="text-[11px] text-ink-3 text-center max-w-[600px]">The whole set scores as one attempt: {passMark} of {drill.count} inside the clock counts as a clean cold pass. Answers after the buzzer are discarded, not marked wrong.</p>
    </div>
  );
}

function Stat({ label, value, color = "text-ink" }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] text-ink-3">{label}</p>
      <p className={`font-mono text-[14px] font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function VerdictView({ verdict, served, onNext }: { verdict: Verdict; served: Served; onNext: () => void }) {
  const [flagged, setFlagged] = useState<"idle" | "open" | "sent">("idle");
  const [note, setNote] = useState("");
  if (verdict.status === "voided") {
    return (
      <div className="w-full max-w-[560px] bg-surface border border-line rounded-[10px] p-6 flex flex-col gap-3 mt-10">
        <Label color="var(--level-working)">Could not be scored</Label>
        <h2 className="text-[17px] font-semibold">This one is on us</h2>
        <p className="text-[13px] leading-[20px] text-ink-2">Our grader did not answer in time, so this item has been voided rather than marked wrong. Your ability estimate is untouched and the question goes back in the queue.</p>
        <div className="flex gap-2 pt-2">
          <Button onClick={onNext} autoFocus>Next item</Button>
        </div>
      </div>
    );
  }
  const right = verdict.status === "correct";
  const d = verdict.deltas;
  return (
    <div className="w-full max-w-[800px] flex flex-col gap-4 -mt-[64px]">
      <div className={`bg-inset rounded-[10px] px-5 py-4 flex items-center justify-between border-l-2 ${right ? "border-ready" : "border-red"}`}>
        <div>
          <Label color={right ? "var(--level-ready)" : "var(--accent-red)"}>{verdict.status === "timeout" ? "Out of time — scored as incorrect" : right ? "Correct" : verdict.partial ? `${verdict.partial.correct} of ${verdict.partial.total} steps` : "Incorrect"}</Label>
          <p className="text-[12px] text-ink-2 mt-2">
            you answered <span className={`font-mono ${right ? "text-ink" : "line-through"}`}>{verdict.submitted ?? "—"}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-ink-3">correct answer</p>
          <Tex html={verdict.correctHtml} className="font-mono text-[22px] font-bold text-ready" />
        </div>
      </div>

      {verdict.misconception ? (
        <div className="bg-surface border border-line rounded-[10px] p-5">
          <Label color="var(--accent-red)">Misconception matched</Label>
          <p className="font-mono text-[13px] text-ink mt-2">{verdict.misconception.label}</p>
          <Tex as="p" html={verdict.misconception.explanationHtml} className="text-[12px] leading-[19px] text-ink-2 mt-2 block" />
        </div>
      ) : null}
      {verdict.review ? (
        <Link href={`/learn/${verdict.review.skillId}?step=${verdict.review.stepId}&review=1`} className={`bg-blue/5 border border-blue/60 rounded-[10px] px-5 py-3 flex items-center justify-between text-[12.5px] hover:bg-blue/10 ${focusRing}`}>
          <span>↳ Review the 2-minute part of the lesson on this mistake</span>
          <span className="font-mono text-[10.5px] text-blue">{verdict.review.lessonTitle} · step {verdict.review.stepNumber} →</span>
        </Link>
      ) : null}
      {verdict.solutionHtml.length ? (
        <div className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-2">
          <Label>Solution</Label>
          {verdict.solutionHtml.map((h, i) => (
            <Tex key={i} as="p" html={h} className={`text-[13px] leading-[21px] block ${i === verdict.solutionHtml.length - 1 ? "text-ready" : "text-ink-2"}`} />
          ))}
          <p className="text-[10px] text-ink-3 mt-1">Revealed only now, and only because you answered.</p>
        </div>
      ) : null}
      {d ? (
        <div className="bg-surface border border-line rounded-[10px] px-5 py-4 grid grid-cols-3">
          <Delta label="your ability" text={`θ ${d.theta[0].toFixed(2)} → ${d.theta[1].toFixed(2)}`} up={d.theta[1] >= d.theta[0]} />
          <Delta label={d.level[1] !== d.level[0] ? "level" : "progress to interview-ready"} text={d.level[1] !== d.level[0] ? `${LEVELS[d.level[0]]} → ${LEVELS[d.level[1]]}` : `cold streak ${d.coldStreak[0]} → ${d.coldStreak[1]}`} up={d.level[1] > d.level[0] || d.coldStreak[1] > d.coldStreak[0]} neutral={d.level[1] === d.level[0] && d.coldStreak[1] === d.coldStreak[0]} />
          <Delta label="item calibration" text={`b ${d.b[0].toFixed(2)} → ${d.b[1].toFixed(2)}`} neutral />
        </div>
      ) : null}
      <div className="flex items-center gap-4 pt-1">
        <Button onClick={onNext} autoFocus className="min-w-[138px]">Next item</Button>
        <span className="font-mono text-[10px] text-ink-3">or press ↵</span>
      </div>
      <div className="flex justify-center pt-2">
        {flagged === "sent" ? (
          <p className="border border-ready/60 bg-ready/10 text-ready text-[12px] rounded-[8px] px-4 py-2" role="status">Flag received — a reviewer will see the exact question you saw. If the item is retired, this attempt is reversed.</p>
        ) : flagged === "open" ? (
          <form
            className="flex gap-2 w-full max-w-[560px]"
            onSubmit={async (e) => {
              e.preventDefault();
              await call(`/api/session-items/${served.sessionItemId}/flag`, { json: { note: note || null } }).catch(() => {});
              setFlagged("sent");
            }}
          >
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What looks wrong? (optional)" className="flex-1 bg-inset border border-line rounded-[8px] px-3 text-[12px] focus:outline-none focus:ring-[3px] focus:ring-blue/55" />
            <Button size="sm" type="submit">Send flag</Button>
          </form>
        ) : (
          <button onClick={() => setFlagged("open")} className={`border border-line rounded-[8px] px-3 py-[6px] text-[12px] text-ink-2 hover:text-ink ${focusRing}`}>⚑ Something wrong with this item?</button>
        )}
      </div>
    </div>
  );
}

function Delta({ label, text, up, neutral }: { label: string; text: string; up?: boolean; neutral?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-ink-3">{label}</p>
      <p className={`font-mono text-[12.5px] mt-1 ${neutral ? "text-ink-2" : up ? "text-ready" : "text-red"}`}>{text}</p>
    </div>
  );
}

function LessonInterstitial({ slot, onSkip }: { slot: LessonSlot; onSkip: () => void }) {
  const [busy, setBusy] = useState(false);
  const refresher = slot.kind === "refresher";
  const href = refresher ? `/learn/${slot.skillId}/refresher?session=${slot.sessionId}` : `/learn/${slot.skillId}?session=${slot.sessionId}`;
  return (
    <Shell title="Practice session">
      <div className="max-w-[560px] mx-auto mt-40 bg-surface border border-line rounded-[10px] p-7 flex flex-col gap-3">
        <Label color={refresher ? "var(--level-familiar)" : "var(--level-ready)"}>{refresher ? "Refresher · about 5 minutes" : "New lesson"}</Label>
        <h1 className="text-[20px] font-semibold">{slot.skillName}</h1>
        <p className="text-[13px] leading-[20px] text-ink-2">
          {refresher
            ? "Recent answers on this skill suggest a gap. A short refresher — the key idea, one faded example and two checks — comes before more practice. Nothing in it is scored."
            : "Today starts with a learning path. It is never scored: hints, retries and solutions are free. Practice picks up straight after."}
        </p>
        <div className="flex gap-2 pt-2">
          <Link href={href} className={btnClass("primary")}>{refresher ? "Start refresher" : "Start lesson"}</Link>
          <Button
            kind="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await (refresher ? call(`/api/lessons/${slot.skillId}/refresher`, { json: { resolution: "skipped" } }) : call(`/api/lessons/${slot.skillId}/skip`, { method: "POST" })).catch(() => {});
              onSkip();
            }}
          >
            Skip for now
          </Button>
        </div>
      </div>
    </Shell>
  );
}

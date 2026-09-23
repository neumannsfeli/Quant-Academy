"use client";

import { useEffect, useState } from "react";
import { call, copyFor } from "@/lib/client";
import { Button, Chip, Tex, focusRing } from "./ui";

type Demo = { seed: number; band: number; type: string; stemHtml: string };
type Result = { correct: boolean; answerHtml: string; solutionHtml: string[]; misconception: { id: string; label: string; explanationHtml: string } | null };

/** Frame 07 · "A real item — try it before you sign up". Graded by the same checker as practice. */
export function DemoItem({ initial, interactive = true }: { initial: Demo | null; interactive?: boolean }) {
  const [item, setItem] = useState(initial);
  const [raw, setRaw] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!item) call<Demo>("/api/demo").then(setItem).catch(() => {});
  }, [item]);
  if (!item) return <div className="h-[180px]" />;
  return (
    <div className="grid grid-cols-2 max-[800px]:grid-cols-1 gap-4">
      <div className="bg-surface border border-line rounded-[10px] p-7 flex flex-col items-center gap-4 text-center">
        <div className="flex gap-2">
          <Chip tone="blue">{item.type}</Chip>
          <Chip>Band {item.band}</Chip>
          <Chip tone="green">Seed {item.seed}</Chip>
        </div>
        <Tex as="p" className="text-[20px] font-semibold leading-[28px]" html={item.stemHtml} />
        {interactive ? (
          <form
            className="flex flex-col items-center gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!raw.trim()) return;
              setBusy(true);
              setErr(null);
              try {
                setRes(await call<Result>("/api/demo", { json: { seed: item.seed, raw } }));
              } catch (x) {
                setErr(copyFor(x));
              } finally {
                setBusy(false);
              }
            }}
          >
            <input value={raw} onChange={(e) => setRaw(e.target.value)} disabled={!!res} placeholder="your answer" aria-label="Your answer" autoComplete="off" className={`w-[160px] bg-inset border border-line-strong rounded-[8px] px-4 py-[10px] font-mono text-[14px] text-center ${focusRing}`} />
            {res ? (
              <Button
                kind="secondary"
                size="sm"
                type="button"
                onClick={async () => {
                  setRes(null);
                  setRaw("");
                  setItem(await call<Demo>("/api/demo"));
                }}
              >
                Another seed
              </Button>
            ) : (
              <Button size="sm" type="submit" loading={busy}>Check answer</Button>
            )}
            {err ? <span className="text-[11px] text-red">{err}</span> : null}
          </form>
        ) : (
          <span className="font-mono text-[10px] text-ink-3">answer on desktop</span>
        )}
        <span className="font-mono text-[9.5px] text-ink-3">reload the page and the dice change</span>
      </div>
      <div className="bg-surface border border-line rounded-[10px] p-6 flex flex-col gap-3" aria-live="polite">
        {res ? (
          res.correct ? (
            <>
              <span className="label" style={{ color: "var(--level-ready)" }}>Correct</span>
              <p className="text-[12.5px] text-ink-2">
                The answer is <Tex html={res.answerHtml} />. In the app this would count toward the skill — cold, on a seed you had never seen.
              </p>
              <ol className="flex flex-col gap-2 text-[12px] text-ink-2 list-decimal pl-5">
                {res.solutionHtml.map((h, i) => <li key={i}><Tex html={h} /></li>)}
              </ol>
            </>
          ) : (
            <>
              <span className="label" style={{ color: "var(--accent-red)" }}>{res.misconception ? "A named mistake" : "Not this time"}</span>
              {res.misconception ? (
                <>
                  <p className="font-mono text-[13px] text-ink">{res.misconception.id.replace(/^mc\.[a-z]+\./, "")}</p>
                  <Tex as="p" className="text-[12.5px] leading-[19px] text-ink-2" html={res.misconception.explanationHtml} />
                </>
              ) : null}
              <p className="text-[12.5px] text-ink-2">The answer is <Tex html={res.answerHtml} />.</p>
              <ol className="flex flex-col gap-2 text-[12px] text-ink-2 list-decimal pl-5">
                {res.solutionHtml.map((h, i) => <li key={i}><Tex html={h} /></li>)}
              </ol>
            </>
          )
        ) : (
          <>
            <span className="label" style={{ color: "var(--accent-red)" }}>And if you get it wrong</span>
            <p className="font-mono text-[13px] text-ink">max-of-expectation</p>
            <p className="text-[12.5px] leading-[19px] text-ink-2">
              You are not told “incorrect”. Every wrong option is tied to a named error at authoring time, so you get which mistake you made, why it is wrong, and where it will bite you again.
            </p>
            <ul className="border-t border-line pt-3 flex flex-col gap-2 text-[11.5px] text-ink-3">
              <li>· Solutions appear only after you answer</li>
              <li>· Retries on the same seed never count toward mastery</li>
              <li>· Timeouts are scored as wrong, because they are</li>
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** Frame 08 · the runner needs a keyboard: email yourself the link. */
export function DesktopHandoff() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  return (
    <div className="border border-blue/70 rounded-[12px] bg-surface p-5 flex flex-col gap-3">
      <span className="label" style={{ color: "var(--accent-blue)" }}>The runner needs a keyboard</span>
      <p className="text-[13px] leading-[20px] text-ink-2">Timed problems and a numeric keypad do not work well on a phone yet, so practice is desktop-only for now. Send yourself the link and start there.</p>
      {state === "sent" ? (
        <p className="text-[13px] text-ready" role="status">Sent. Open it on your laptop.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setState("busy");
            try {
              await call("/api/handoff", { json: { email } });
              setState("sent");
            } catch {
              setState("error");
            }
          }}
        >
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" aria-label="Email" className={`h-[44px] bg-inset border border-line-strong rounded-[8px] px-4 text-[14px] ${focusRing}`} />
          <Button type="submit" loading={state === "busy"} className="!py-3">Email me the link</Button>
          {state === "error" ? <p className="text-[11px] text-red" role="alert">That did not go through — check the address and try again.</p> : null}
        </form>
      )}
      <p className="text-[11px] text-ink-3">One email. No list, no drip sequence.</p>
    </div>
  );
}

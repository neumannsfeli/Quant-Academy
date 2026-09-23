"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call, copyFor } from "@/lib/client";
import { Button, Chip, Label, focusRing } from "./ui";

type Arch = { id: string; name: string; firms: string | null; selectable: boolean; note: string | null; weights: Record<string, number> };
const DOMAIN_SHORT: Record<string, string> = { prob: "Probability", trade: "Trading games", stoch: "Stochastic", mental: "Mental math", stats: "Statistics", deriv: "Derivatives" };
const RESEARCH_DISPLAY: [string, number][] = [["Probability", 25], ["Statistics", 25], ["Stochastic", 20], ["Programming", 20], ["Linear algebra", 10]];

export function Onboarding({ archetypes, current }: { archetypes: Arch[]; current: string | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState(current ?? "puzzle-trading");
  const [date, setDate] = useState("");
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const order = ["speed-mm", "puzzle-trading", "research"];
  const sorted = [...archetypes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const hub = choice === "speed-mm" ? "Two-digit multiplication" : "Counting & combinatorics";

  async function go(start: "placement" | "lessons" | "skip") {
    if (!age) {
      setErr("Confirm you are 16 or over to continue.");
      return;
    }
    setBusy(start);
    setErr(null);
    try {
      await call("/api/me/goal", { json: { archetypeId: choice, interviewDate: date || null, ageConfirmed: true, start, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      router.push(start === "placement" ? "/placement" : start === "lessons" ? "/learn" : "/home");
      router.refresh();
    } catch (e) {
      setErr(copyFor(e));
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-16 pt-[140px] pb-16">
      <div className="flex gap-[6px] mb-8" aria-hidden><span className="h-[4px] w-[30px] rounded-full bg-blue" /><span className="h-[4px] w-[20px] rounded-full bg-line-strong" /></div>
      <Label>Step 1 of 2 · Goal</Label>
      <h1 className="text-[26px] font-semibold mt-3">Which interviews are you preparing for?</h1>
      <p className="text-[13.5px] leading-[20px] text-ink-2 text-center max-w-[600px] mt-3">This sets the domain weights behind your readiness score and which skills count as required. You can change it later.</p>
      <div className="grid grid-cols-3 gap-4 w-full max-w-[1150px] mt-9" role="radiogroup" aria-label="Firm archetype">
        {sorted.map((a) => {
          const selected = a.id === choice;
          const rows: [string, number][] = a.id === "research" ? RESEARCH_DISPLAY : Object.entries(a.weights).sort((x, y) => y[1] - x[1]).map(([d, w]) => [DOMAIN_SHORT[d] ?? d, Math.round(w * 100)]);
          return (
            <button
              key={a.id}
              role="radio"
              aria-checked={selected}
              disabled={!a.selectable}
              onClick={() => setChoice(a.id)}
              className={`text-left rounded-[12px] border p-5 min-h-[266px] flex flex-col gap-3 ${focusRing} ${selected ? "border-blue bg-elevated" : "border-line bg-surface"} ${a.selectable ? "hover:border-line-strong" : "opacity-50 cursor-not-allowed"}`}
            >
              <div className="flex justify-between items-center">
                <span className="text-[15px] font-semibold">{a.name}</span>
                <span className={`size-4 rounded-full border ${selected ? "bg-blue border-blue" : "border-line-strong"}`} />
              </div>
              <span className="font-mono text-[10px] text-ink-3">{(a.firms ?? "").replace(/, /g, " · ")}</span>
              <span className="h-px bg-line" />
              {rows.map(([d, w]) => (
                <div key={d} className="flex justify-between text-[12px]"><span className="text-ink-2">{d}</span><span className="font-mono text-ink-2">{w}%</span></div>
              ))}
              {!a.selectable ? <Chip tone="amber" className="self-start mt-1">Coming with the Statistics track</Chip> : null}
            </button>
          );
        })}
      </div>
      <div className="w-full max-w-[1150px] mt-7 bg-surface border border-line rounded-[12px] p-6 flex items-center gap-8">
        <div className="flex-1 flex flex-col gap-2">
          <Label>Step 2 · Placement</Label>
          <h2 className="text-[17px] font-semibold">A 20-minute adaptive placement</h2>
          <p className="text-[12.5px] leading-[19px] text-ink-2">24 items across the four domains your profile requires, adapting to each answer. It seeds θ everywhere so the recommender has something to work with on day one.</p>
          <div className="flex items-center gap-6 mt-2 text-[12px] text-ink-2">
            <label className="flex items-center gap-2">
              Interview date <span className="text-ink-3">(optional)</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`bg-inset border border-line rounded-[6px] px-2 py-1 text-ink ${focusRing}`} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="size-4 accent-[var(--accent-blue)]" />
              I am 16 or over
            </label>
          </div>
          {err ? <p className="text-[11.5px] text-red" role="alert">{err}</p> : null}
        </div>
        <div className="w-[210px] flex flex-col gap-2">
          <Button onClick={() => go("placement")} loading={busy === "placement"}>Start placement</Button>
          <Button kind="ghost" onClick={() => go("lessons")} loading={busy === "lessons"}>New to this? Start with lessons</Button>
        </div>
      </div>
      <p className="text-[11px] text-ink-3 mt-7">
        New to all of this? Start with lessons — placement is skipped and your first lesson is {hub}. You can take placement any time.{" "}
        <button className="underline hover:text-ink" onClick={() => go("skip")}>Skip both for now</button>
      </p>
    </div>
  );
}

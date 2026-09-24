"use client";

import Link from "next/link";
import { useState } from "react";
import { StartSession } from "../actions";
import { ButtonLink, focusRing } from "../ui";

type Skill = { id: string; name: string; level: number; levelName: string; status: string; retention: number | null; fading: boolean; prereqIds: string[]; dependentIds: string[]; practiceUnlocked: boolean; hasLesson: boolean; detail: string };
type Lane = { id: string; name: string; weight: number; learned: number; proved: number; total: number; tiers: { tier: number; skills: Skill[] }[] };

const CARD: Record<string, string> = {
  locked: "border-dashed border-line-strong/70 text-ink-3",
  ready: "border-line-strong bg-canvas",
  learned: "border-line-strong bg-elevated",
  working: "border-working/70 bg-working/15",
  interview_ready: "border-ready/60 bg-ready/15",
};
const TAG: Record<string, [string, string]> = {
  locked: ["Locked", "text-ink-3"],
  ready: ["Ready to learn", "text-blue"],
  learned: ["Learned", "text-ink-3"],
  working: ["Working", "text-working"],
  interview_ready: ["Interview-ready", "text-ready"],
};

/** Frame 33 · Progress — skill map. Selecting a card fills the bar at the bottom. */
export function SkillMap({ lanes, names }: { lanes: Lane[]; names: Record<string, string> }) {
  const all = lanes.flatMap((l) => l.tiers.flatMap((t) => t.skills));
  const byId = new Map(all.map((k) => [k.id, k]));
  const [sel, setSel] = useState<string | null>(null);
  const selected = sel ? byId.get(sel) ?? null : null;
  const cols = lanes.length >= 4 ? "grid-cols-4" : lanes.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <>
      <div className={`grid ${cols} max-[1180px]:grid-cols-2 gap-[14px] items-start`}>
        {lanes.map((l) => (
          <section key={l.id} className="bg-surface border border-line rounded-[10px] p-3 flex flex-col gap-2" aria-label={l.name}>
            <div className="flex justify-between items-baseline">
              <h2 className="text-[12.5px] font-semibold">{l.name}</h2>
              {l.weight ? <span className="font-mono text-[9.5px] text-ink-3">{Math.round(l.weight * 100)}%</span> : null}
            </div>
            <p className="font-mono text-[9px] text-ink-3 -mt-1">
              {l.learned} learned · {l.proved} proved · {l.total} skills
            </p>
            {l.tiers.map((t) => (
              <div key={t.tier} className="flex flex-col gap-[6px]">
                <span className="font-mono text-[8px] tracking-[0.14em] text-ink-3 pt-1">TIER {t.tier}</span>
                <div className="grid grid-cols-2 gap-[6px]">
                  {t.skills.map((k) => {
                    const [tag, tone] = TAG[k.status] ?? TAG.ready!;
                    const isSel = sel === k.id;
                    return (
                      <button
                        key={k.id}
                        onClick={() => setSel(isSel ? null : k.id)}
                        aria-pressed={isSel}
                        className={`text-left rounded-[6px] border px-[9px] py-[7px] flex flex-col gap-[3px] ${CARD[k.status] ?? CARD.ready} ${isSel ? "ring-2 ring-blue/70 border-blue" : ""} ${focusRing}`}
                      >
                        <span className={`text-[11px] leading-[14px] ${k.status === "locked" ? "text-ink-3" : "text-ink"}`}>{k.name}</span>
                        <span className={`font-mono text-[7.5px] tracking-[0.1em] uppercase ${tone}`}>
                          {tag}
                          {k.fading && k.retention !== null ? <span className="text-working"> ↓ r {k.retention.toFixed(2)}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      {selected ? (
        <div className="sticky bottom-4 mt-4 bg-surface border border-blue/70 rounded-[10px] px-5 py-3 flex items-center gap-8 shadow-2xl" role="region" aria-label="Selected skill">
          <div>
            <p className="font-mono text-[8.5px] tracking-[0.14em] text-blue">SELECTED</p>
            <p className="text-[14px] font-semibold">{selected.name}</p>
          </div>
          <div>
            <p className="label">Status</p>
            <p className={`font-mono text-[11.5px] ${TAG[selected.status]?.[1]}`}>
              {TAG[selected.status]?.[0]}
              {selected.retention !== null ? ` · r ${selected.retention.toFixed(2)}` : ""}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="label">Needs</p>
            <p className="text-[11.5px] text-ink-2 truncate">
              {selected.prereqIds.length
                ? selected.prereqIds.map((p, i) => (
                    <span key={p}>
                      {i ? " · " : ""}
                      {names[p] ?? p} {(byId.get(p)?.level ?? 0) >= 2 ? "✓" : (byId.get(p)?.level ?? 0) >= 1 ? "(learned)" : ""}
                    </span>
                  ))
                : "nothing — an entry point"}
            </p>
          </div>
          {selected.dependentIds.length ? (
            <div className="max-w-[220px]">
              <p className="label">Unlocks</p>
              <p className="text-[11.5px] text-ink-2 truncate">{selected.dependentIds.map((d) => names[d] ?? d).join(", ")}</p>
            </div>
          ) : null}
          <div className="flex gap-2 shrink-0">
            <ButtonLink href={`/skills/${encodeURIComponent(selected.id)}`} kind="secondary" size="sm">Open skill</ButtonLink>
            {selected.practiceUnlocked ? (
              <StartSession skillId={selected.id} size="sm">Practise</StartSession>
            ) : selected.status === "ready" && selected.hasLesson ? (
              <ButtonLink href={`/learn/${encodeURIComponent(selected.id)}`} size="sm">Start lesson</ButtonLink>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-ink-3">
          Select a skill to see what it needs and unlocks. <Link href="/learn" className="underline hover:text-ink">Learn</Link> lists the same skills in study order.
        </p>
      )}
    </>
  );
}

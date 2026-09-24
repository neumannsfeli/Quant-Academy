import { blendReadiness } from "@qa/scoring";
import { SiteFooter, SiteHeader } from "@/components/site";
import { Bar, Label, Meter } from "@/components/ui";
import { scoreColor } from "@/lib/format";
import { currentUser } from "@/lib/server";

export const metadata = { title: "How scoring works" };

const LEVELS = [
  [0, "Unseen", "Nothing yet", "text-ink-3"],
  [1, "Familiar", "Worked through the lesson — every step, every check answered — or already answered a practice question correctly", "text-familiar"],
  [2, "Working", "Would more likely than not handle an interview-level question, across at least three attempts", "text-working"],
  [3, "Interview-ready", "Three in a row, correct, on questions you have never seen, at interview difficulty, inside the time limit", "text-ready"],
] as const;

// A worked example, computed with the production formula (product spec §6.3).
const EXAMPLE = [
  { name: "Probability", weight: 0.4, value: 82 },
  { name: "Trading games", weight: 0.25, value: 61 },
  { name: "Stochastic processes", weight: 0.2, value: 55 },
  { name: "Mental math", weight: 0.15, value: 24 },
];

/** Frame 23 · How scoring works (public). */
export default async function HowScoringWorks() {
  const user = await currentUser();
  const blend = blendReadiness(EXAMPLE.map((d) => ({ weight: d.weight, value: d.value / 100 })));
  const avg = Math.round(EXAMPLE.reduce((a, d) => a + d.value, 0) / EXAMPLE.length);
  const score = Math.round(blend.raw * 100);
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader signedIn={!!user} />
      <main className="flex-1 max-w-[920px] w-full mx-auto px-6 py-16 flex flex-col gap-12">
        <section className="flex flex-col gap-4">
          <Label>How scoring works</Label>
          <h1 className="text-[36px] max-[700px]:text-[26px] leading-[1.15] font-bold tracking-[-0.02em]">Scored by your weakest area, not your average.</h1>
          <p className="text-[15px] leading-[24px] text-ink-2">
            Your readiness score estimates how well you would do, today, on interview-style questions across the areas your target firms test. Here is exactly how it is built — because a score you cannot inspect is a score you should not trust.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <Label>What we track for every skill</Label>
          <div className="grid grid-cols-3 max-[700px]:grid-cols-1 gap-3">
            {[
              ["var(--accent-blue)", "Ability", "Moves after every answer — up when right, down when wrong, and further when the result was surprising. A timeout counts as wrong."],
              ["var(--level-working)", "Freshness", "Knowledge fades. Each skill comes back for review just before you would likely miss it, and each success stretches the gap."],
              ["var(--level-ready)", "Level", "What you have actually demonstrated, cold. The only one of the three you have to earn under interview conditions."],
            ].map(([c, t, d]) => (
              <div key={t} className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-3">
                <span className="w-6 h-[3px] rounded-full" style={{ background: c }} />
                <h2 className="text-[15px] font-semibold">{t}</h2>
                <p className="text-[12px] leading-[19px] text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Label>The four levels</Label>
          {LEVELS.map(([lvl, name, desc, tone]) => (
            <div key={name} className={`bg-surface border rounded-[8px] px-4 py-3 flex items-center gap-5 ${lvl === 3 ? "border-ready/70" : "border-line"}`}>
              <Meter level={lvl} />
              <span className={`w-[120px] shrink-0 text-[12.5px] font-medium ${tone}`}>{name}</span>
              <span className="text-[12px] text-ink-2">{desc}</span>
            </div>
          ))}
          <p className="text-[11.5px] leading-[18px] text-ink-3">
            You can lose a level: a wrong answer at interview difficulty on an Interview-ready skill moves it back to Working. Rustiness alone never does — it just brings the skill back for review.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <Label>From skills to one number</Label>
          <p className="text-[13.5px] leading-[21px] text-ink-2">Each skill is scored from ability and freshness, capped by its level. Skills combine into areas, and areas into your readiness — with the weakest area dominating.</p>
          <div className="bg-surface border border-line rounded-[10px] p-6 grid grid-cols-[1fr_220px] max-[700px]:grid-cols-1 gap-8 items-center">
            <div className="flex flex-col gap-3">
              {EXAMPLE.map((d) => (
                <div key={d.name} className="flex items-center gap-4">
                  <span className="w-[140px] text-[12px] text-ink-2">{d.name}</span>
                  <Bar className="flex-1" value={d.value} color={scoreColor(d.value)} />
                  <span className="w-8 font-mono text-[12px]" style={{ color: scoreColor(d.value) }}>{d.value}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-3">average</span>
              <span className="font-mono text-[26px] text-ink-3 line-through">{avg}</span>
              <span className="text-[11px] text-ink-3 mt-3">your readiness</span>
              <span className="font-mono text-[48px] font-bold leading-none">{score}</span>
              <span className="text-[11px] leading-[16px] text-ink-3 mt-3">An interviewer who finds a gap does not average it against your strengths.</span>
            </div>
          </div>
          <p className="text-[11px] text-ink-3">
            Precisely: readiness = 0.25 × weighted mean + 0.75 × weighted power mean with p = −4, using your profile’s area weights. The power mean is what lets one weak area pull the whole score down.
          </p>
        </section>

        <section className="grid grid-cols-3 max-[700px]:grid-cols-1 gap-3">
          {[
            ["var(--level-working)", "Why it starts low", "Placement aims you; it does not award levels. Nearly everyone sees a score in the thirties after placement — strong candidates included. It rises as you prove skills cold."],
            ["var(--accent-blue)", "Provisional", "Shown as “—” until you have answered 20 questions, with at least 5 in every required area. Before that, a number would be noise dressed as authority."],
            ["var(--level-ready)", "Validated", "Pass the timed assessment and your score is validated for 21 days. It can also move skills down if they did not hold up under test conditions. That is the point."],
          ].map(([c, t, d]) => (
            <div key={t} className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-2">
              <Label color={c}>{t}</Label>
              <p className="text-[12px] leading-[19px] text-ink-2">{d}</p>
            </div>
          ))}
        </section>

        <section className="bg-surface border-l-2 border-working rounded-[8px] px-6 py-5 flex flex-col gap-3">
          <Label color="var(--level-working)">What we do not claim</Label>
          <p className="text-[13.5px] leading-[21px] text-ink-2">
            We do not yet know how a given score maps to passing a real interview — we do not have enough outcome data to say it honestly. If you choose to tell us how your interviews go, you help make that claim possible for the next person.
          </p>
          <p className="text-[12px] text-ink-3">Think a score is wrong? Flag the question, or email support — a person will look at your history.</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

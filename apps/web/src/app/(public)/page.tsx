import Link from "next/link";
import { demoItem, getContent } from "@qa/core";
import { DemoItem, DesktopHandoff } from "@/components/landing";
import { SiteFooter, SiteHeader } from "@/components/site";
import { Label, btnClass } from "@/components/ui";
import { currentUser } from "@/lib/server";

export const dynamic = "force-dynamic";

const PILLARS = [
  ["var(--accent-blue)", "Taught, then tested", "Every skill starts with a guided lesson — simulations, worked examples, and checks you can get wrong for free. Learning is never scored. Proof is."],
  ["var(--level-ready)", "Unseen every time", "Every item is a template with a random seed. You never get the same instance twice, so a correct answer means you can do it — not that you remember what the answer was."],
  ["var(--accent-red)", "Your worst domain is your score", "Readiness is a weighted minimum, not an average. 82% on probability does not rescue 24% on mental math, and an interviewer will not average them either."],
  ["var(--level-working)", "Forgetting is modelled", "Every skill carries a retention half-life. What you learned in week one resurfaces before it rots, scheduled against the date you actually interview."],
] as const;

/** Frames 07 (desktop) and 08 (mobile) · Landing. */
export default async function Landing() {
  const [user, content] = await Promise.all([currentUser(), getContent()]);
  const demo = await demoItem().catch(() => null);
  const live = content.domains.filter((d) => d.live);
  const stubs = content.domains.filter((d) => !d.live);
  const liveSkills = content.skillList.filter((k) => content.domainById.get(k.domainId)?.live);
  const cta = user ? "/home" : "/signup";

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader signedIn={!!user} />
      <main className="flex-1">
        <section className="max-w-[900px] mx-auto px-6 pt-20 max-[700px]:pt-10 pb-16 text-center flex flex-col items-center gap-6">
          <span className="border border-ready/60 bg-ready/10 text-ready font-mono text-[9.5px] tracking-[0.14em] px-3 py-[5px] rounded-[5px]">FREE WHILE WE CALIBRATE</span>
          <h1 className="text-[48px] max-[700px]:text-[30px] leading-[1.12] font-bold tracking-[-0.02em]">
            Learn it here. Prove it cold.
            <br className="max-[700px]:hidden" /> Know when you are ready.
          </h1>
          <p className="text-[16px] max-[700px]:text-[14px] leading-[26px] text-ink-2 max-w-[720px]">
            Quant Academy teaches the probability, stochastic processes, trading games and mental maths that trading-firm interviews test — then measures what you can do cold, on problems you have never seen, and scores you on your weakest area, because that is what an interview does.
          </p>
          <div className="max-[700px]:hidden flex flex-col items-center gap-4">
            <div className="flex gap-3">
              <Link href={cta} className={btnClass("primary", "lg")}>{user ? "Open the app" : "Start free"}</Link>
              <a href="#try" className={btnClass("secondary", "lg")}>See a real question</a>
            </div>
            <p className="font-mono text-[10px] text-ink-3">Start from scratch or take a 20-minute placement · no card · desktop only for now</p>
          </div>
          <div className="hidden max-[700px]:block w-full text-left">
            <DesktopHandoff />
          </div>
        </section>

        <section id="how" className="max-w-[1180px] mx-auto px-6 py-16">
          <p className="label text-center mb-6">Why this is not another problem bank</p>
          <div className="grid grid-cols-4 max-[1000px]:grid-cols-2 max-[600px]:grid-cols-1 gap-4">
            {PILLARS.map(([c, t, d]) => (
              <div key={t} className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-3">
                <span className="w-6 h-[3px] rounded-full" style={{ background: c }} />
                <h2 className="text-[14px] font-semibold">{t}</h2>
                <p className="text-[12px] leading-[19px] text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="try" className="max-w-[1180px] mx-auto px-6 py-16">
          <p className="label text-center mb-6">A real item · band {demo?.band ?? 3} · try it before you sign up</p>
          <div className="max-[700px]:hidden"><DemoItem initial={demo} /></div>
          <div className="hidden max-[700px]:block"><DemoItem initial={demo} interactive={false} /></div>
        </section>

        <section id="skills" className="max-w-[1180px] mx-auto px-6 py-16">
          <div className="flex justify-between items-baseline mb-4 flex-wrap gap-2">
            <p className="label">{liveSkills.length} skills · {live.length} live domains · prerequisite-gated</p>
            {stubs.length ? <p className="text-[11px] text-ink-3">{stubs.map((d) => d.name).join(" and ")} tracks in progress</p> : null}
          </div>
          <div className="grid grid-cols-4 max-[1000px]:grid-cols-2 max-[600px]:grid-cols-1 gap-4">
            {live.map((d) => {
              const ks = content.skillList.filter((k) => k.domainId === d.id);
              return (
                <div key={d.id} className="bg-surface border border-line rounded-[10px] p-4 flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{d.name}</h3>
                  <p className="font-mono text-[9.5px] text-ready">{ks.length} skills</p>
                  {ks.filter((_, i) => i % Math.max(1, Math.floor(ks.length / 3)) === 0).slice(0, 3).map((k) => (
                    <p key={k.id} className="text-[11.5px] text-ink-2">{k.name}</p>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        <section className="max-w-[1180px] mx-auto px-6 py-16">
          <div className="bg-surface border-l-2 border-working rounded-[8px] px-6 py-5 flex flex-col gap-3">
            <Label color="var(--level-working)">What we do not know yet</Label>
            <p className="text-[13px] leading-[21px] text-ink-2">
              We are new. The readiness score is built entirely from your measured performance on unseen problems — that part is real. What we cannot yet tell you is how a score of 70 maps to actually passing a first round, because we do not have the outcome data to make that claim honestly.
            </p>
            <p className="text-[13px] leading-[21px] text-ink-2">
              Collecting that data is what this launch is for, which is why everything is free right now. Tell us how your interviews went and you make the score mean something for the person after you.
            </p>
          </div>
        </section>

        <section className="max-w-[900px] mx-auto px-6 py-20 text-center flex flex-col items-center gap-4 max-[700px]:hidden">
          <h2 className="text-[30px] font-semibold tracking-[-0.01em]">Start from wherever you are.</h2>
          <Link href={cta} className={btnClass("primary", "lg")}>{user ? "Open the app" : "Start free"}</Link>
          <p className="font-mono text-[10px] text-ink-3">Beginner or nearly ready · no card · export or delete your data at any time</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

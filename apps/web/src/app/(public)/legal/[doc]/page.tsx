import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site";
import { Label } from "@/components/ui";
import { currentUser } from "@/lib/server";

/**
 * Plain-language summaries of the product's data and content commitments (product spec §18).
 * DRAFT: these need legal review before launch; they describe what the code does, not more.
 */
const DOCS: Record<string, { title: string; sections: [string, string][] }> = {
  privacy: {
    title: "Privacy",
    sections: [
      ["What we store", "Your email address, the answers you submit with their timestamps and timings, the scores derived from them, and your settings. Sign-in uses single-use email links or Google; we never see or store a password."],
      ["What we do with it", "Compute your skill levels, readiness score and review schedule; send the emails you have switched on; and, in aggregate, calibrate how hard each question is. Nothing is sold and there is no advertising tracking."],
      ["Interview outcomes", "Only if you turn on “Share interview outcomes”. Outcomes are analysed de-identified, and you can withdraw at any time in Settings."],
      ["Export", "Settings → Export everything emails you a link to a CSV of every response and score. The link works for one hour."],
      ["Deletion", "Settings → Delete account removes your account, email, settings, progress and scores permanently. Your past answers stay in question statistics with nothing linking them to you, because every other learner’s calibration depends on them."],
      ["Age", "Quant Academy is for people aged 16 and over."],
    ],
  },
  terms: {
    title: "Terms",
    sections: [
      ["The service", "Quant Academy is free while we calibrate. We may change or withdraw features; we will tell you before anything you rely on goes away."],
      ["Your account", "One person per account. Do not share questions in bulk or scrape the item bank — every item is generated for you from a template and seed."],
      ["No guarantee of outcomes", "The readiness score is an estimate from your measured performance. We do not claim it predicts any particular interview result."],
      ["Ending", "You can delete your account at any time. We may suspend accounts that abuse the service."],
    ],
  },
  content: {
    title: "Content & sources",
    sections: [
      ["Original work", "Every item template, lesson and reading is written for Quant Academy. Where a problem is a well-known classic, its source is recorded on the template and credited in the solution."],
      ["Review", "Templates are swept across thousands of seeds for degenerate or ambiguous instances and reviewed by a second person before they are served."],
      ["Found a mistake?", "Use “Something wrong with this question?” on any item or lesson step. A reviewer sees it with the exact seed you had; if a question is retired, answers to it stop counting."],
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  return { title: DOCS[(await params).doc]?.title ?? "Legal" };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const doc = DOCS[(await params).doc];
  if (!doc) notFound();
  const user = await currentUser();
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader signedIn={!!user} />
      <main className="flex-1 max-w-[760px] w-full mx-auto px-6 py-16 flex flex-col gap-8">
        <div>
          <Label>Quant Academy</Label>
          <h1 className="text-[30px] font-bold mt-2">{doc.title}</h1>
        </div>
        {doc.sections.map(([h, p]) => (
          <section key={h} className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold">{h}</h2>
            <p className="text-[13.5px] leading-[22px] text-ink-2">{p}</p>
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}

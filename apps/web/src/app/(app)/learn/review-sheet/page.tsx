import Link from "next/link";
import { getReviewSheet } from "@qa/core";
import { PrintButtons } from "@/components/print";
import { ButtonLink, Card, PageTitle, Tabs, Tex } from "@/components/ui";
import { requireUser } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review sheet" };

/** Frame 35 · Learn — review sheet. Prints to one clean document. */
export default async function ReviewSheetPage() {
  const user = await requireUser();
  const sheet = await getReviewSheet(user.id);
  const learned = sheet.domains.reduce((a, d) => a + d.learned, 0);

  return (
    <div className="px-8 py-[22px] review-sheet">
      <PageTitle tabs={<Tabs active="/learn/review-sheet" items={[{ href: "/learn", label: "Learning paths" }, { href: "/learn/review-sheet", label: "Review sheet" }]} />} right={learned ? <PrintButtons /> : null}>
        Learn
      </PageTitle>
      {learned === 0 ? (
        <Card className="p-8 max-w-[560px] flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold">Your sheet is empty</h2>
          <p className="text-[12px] leading-[19px] text-ink-2">Each lesson you finish adds its key results here, in learning order. By the night before an interview it is the one page worth rereading.</p>
          <div><ButtonLink href="/learn">Start a lesson</ButtonLink></div>
        </Card>
      ) : (
        <>
          <p className="text-[12px] text-ink-2 mb-5">
            Key results from the {learned} skill{learned === 1 ? "" : "s"} you have learned, in learning order. It grows every time you finish a lesson — the realistic use is the night before an interview.
          </p>
          <div className="columns-2 max-[1100px]:columns-1 gap-4 print:columns-2">
            {sheet.domains.map((d) => (
              <Card key={d.id} className="p-4 mb-4 break-inside-avoid flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-[13.5px] font-semibold">{d.name}</h2>
                  <span className="font-mono text-[9.5px] text-ink-3">{d.learned} of {d.total} learned</span>
                </div>
                {d.entries.map((e) => (
                  <div key={e.skillId} className="flex flex-col gap-[6px]">
                    <Link href={`/skills/${encodeURIComponent(e.skillId)}`} className="text-[11.5px] text-ink-2 hover:text-ink">{e.name}</Link>
                    {e.resultsHtml.map((h, i) => (
                      <Tex key={i} as="div" html={h} className="bg-inset rounded-[5px] px-[10px] py-[7px] text-[11.5px] leading-[18px] text-ink" />
                    ))}
                  </div>
                ))}
                {d.learnedWithoutPath.length ? <p className="text-[10px] text-ink-3">Learned through practice (no path yet): {d.learnedWithoutPath.join(", ")}</p> : null}
                {d.notYet.length ? <p className="text-[10px] text-ink-3">Not yet: {d.notYet.slice(0, 6).join(", ")}{d.notYet.length > 6 ? `, +${d.notYet.length - 6}` : ""} — learn them to add their results</p> : null}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

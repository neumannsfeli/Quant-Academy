import Link from "next/link";
import { reviewQueue } from "@qa/core";
import { focusRing } from "@/components/ui";
import { requireStaff } from "@/lib/server";

export const metadata = { title: "Review queue" };

/** Product spec §12.3 — second-person review before anything is served. Oldest first. */
export default async function ReviewPage() {
  await requireStaff();
  const rows = await reviewQueue();
  return (
    <div className="px-6 py-5">
      <h1 className="text-[18px] font-semibold mb-1">Review queue</h1>
      <p className="text-[11.5px] text-ink-3 mb-4">Templates waiting for a second person, oldest first. Open one to preview seeds, check the sweep and promote it.</p>
      <div className="bg-surface border border-line rounded-[10px] overflow-hidden">
        <table className="w-full text-[11.5px]">
          <thead className="font-mono text-[8.5px] tracking-[0.12em] uppercase text-ink-3 text-left">
            <tr className="border-b border-line">
              {["Template", "Skill", "Type", "Band", "Submitted", "Sweep"].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.id}@${r.version}`} className="border-b border-line last:border-0 hover:bg-elevated/50">
                <td className="px-4 py-[10px] font-mono"><Link href={`/admin/templates?id=${encodeURIComponent(r.id)}`} className={`hover:text-blue rounded ${focusRing}`}>{r.id} <span className="text-ink-3">v{r.version}</span></Link></td>
                <td className="px-4 font-mono text-ink-2">{r.skillId}</td>
                <td className="px-4 text-ink-2">{r.type}</td>
                <td className="px-4 font-mono">{r.band}</td>
                <td className="px-4 text-ink-3">{new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                <td className={`px-4 font-mono ${r.sweepPassed ? "text-ready" : "text-red"}`}>{r.sweepPassed ? "pass" : `fail · ${r.issues.filter((i) => i.severity === "fail").length}`}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-3">Nothing waiting for review.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

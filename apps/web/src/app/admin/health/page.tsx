import Link from "next/link";
import { itemHealth } from "@qa/core";
import { focusRing } from "@/components/ui";
import { requireStaff } from "@/lib/server";

export const metadata = { title: "Item health" };

function statusOf(alerts: string[]) {
  if (alerts.includes("negative discrimination") || alerts.includes("flag rate > 5%")) return ["Auto-flagged", "bg-red/15 text-red"] as const;
  if (alerts.includes("mis-banded")) return ["Mis-banded", "bg-working/15 text-working"] as const;
  if (alerts.length) return ["Watch", "bg-working/15 text-working"] as const;
  return ["Healthy", "bg-ready/15 text-ready"] as const;
}

/** Frame 27 · Admin — item health (product spec §12.5, §14.3). */
export default async function HealthPage() {
  await requireStaff();
  const { rows, calibration } = await itemHealth();
  const counted = rows.map((r) => statusOf(r.alerts)[0]);
  const cards = [
    ["Served templates", String(rows.length), "var(--text-primary)"],
    ["Healthy", String(counted.filter((c) => c === "Healthy").length), "var(--level-ready)"],
    ["Watch", String(counted.filter((c) => c === "Watch").length), "var(--level-working)"],
    ["Auto-flagged", String(counted.filter((c) => c === "Auto-flagged").length), "var(--accent-red)"],
    ["Mis-banded", String(counted.filter((c) => c === "Mis-banded").length), "var(--level-working)"],
    ["Brier score", calibration.brier === null ? "—" : calibration.brier.toFixed(3), "var(--accent-blue)"],
  ] as const;
  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      <div className="grid grid-cols-6 gap-3">
        {cards.map(([l, v, c]) => (
          <div key={l} className="bg-surface border border-line rounded-[10px] px-4 py-3">
            <p className="label">{l}</p>
            <p className="font-mono text-[18px] mt-1" style={{ color: c }}>{v}</p>
          </div>
        ))}
      </div>
      <div className="bg-surface border border-line rounded-[10px] overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="font-mono text-[8.5px] tracking-[0.12em] uppercase text-ink-3 text-left">
            <tr className="border-b border-line">
              {["Template", "Type", "Band", "Resp", "p", "Disc", "Time/limit", "Flags", "b drift", "Status"].map((h) => <th key={h} className="px-3 py-3 font-normal">{h}</th>)}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.slice(0, 300).map((r) => {
              const [label, tone] = statusOf(r.alerts);
              const tl = r.meanSec !== null ? r.meanSec / r.limitSec : null;
              return (
                <tr key={`${r.templateId}@${r.version}`} className={`border-b border-line last:border-0 ${label === "Auto-flagged" ? "bg-red/5" : ""}`} title={r.alerts.join(", ")}>
                  <td className="px-3 py-[9px]"><Link href={`/admin/templates?id=${encodeURIComponent(r.templateId)}`} className={`hover:text-blue rounded ${focusRing}`}>{r.templateId}</Link></td>
                  <td className="px-3 text-ink-2 font-sans">{r.type}</td>
                  <td className="px-3 text-ink-2">{r.band}</td>
                  <td className="px-3 text-ink-2">{r.responses.toLocaleString("en-GB")}</td>
                  <td className={`px-3 ${r.responses >= 30 && r.pValue !== null && (r.pValue < 0.35 || r.pValue > 0.85) ? "text-working" : "text-ink-2"}`}>{r.pValue === null ? "—" : r.pValue.toFixed(2)}</td>
                  <td className={`px-3 ${r.discrimination !== null && r.discrimination < 0 ? "text-red" : r.discrimination !== null && r.discrimination < 0.1 ? "text-working" : "text-ink-2"}`}>{r.discrimination === null ? "—" : r.discrimination.toFixed(2)}</td>
                  <td className={`px-3 ${tl !== null && tl > 0.9 ? "text-working" : "text-ink-2"}`}>{tl === null ? "—" : tl.toFixed(2)}</td>
                  <td className="px-3 text-ink-2">{r.flagRate ? `${(r.flagRate * 100).toFixed(1)}%` : "0"}</td>
                  <td className={`px-3 ${Math.abs(r.drift) > 0.8 ? "text-working" : "text-ink-2"}`}>{r.drift > 0 ? "+" : ""}{r.drift.toFixed(1)}</td>
                  <td className="px-3"><span className={`inline-block font-sans font-mono text-[8.5px] tracking-[0.12em] uppercase rounded px-2 py-[3px] ${tone}`}>{label}</span></td>
                </tr>
              );
            })}
            {!rows.length ? <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-3 font-sans">No live templates have statistics yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-[1fr_320px] gap-4">
        <p className="bg-inset rounded-[10px] px-4 py-3 text-[11px] leading-[17px] text-ink-3">
          Healthy p is 0.35–0.85 for the band. Discrimination below 0 auto-flags; below 0.1 is watched. Time/limit near 1.0 means the limit is mis-set. |b drift| &gt; 0.8 means the band is wrong and band selection will aim users badly — re-band it. Stats appear once a template has 30 responses. Brier score is the model-health number from product spec §14.3.
        </p>
        <div className="bg-surface border border-line rounded-[10px] p-3">
          <p className="label mb-2">Calibration · predicted vs actual · n {calibration.n}</p>
          <svg viewBox="0 0 100 100" className="w-full h-[140px]" role="img" aria-label="Calibration curve">
            <line x1="0" y1="100" x2="100" y2="0" stroke="var(--border-strong)" strokeDasharray="3 3" />
            <polyline fill="none" stroke="var(--accent-blue)" strokeWidth="1.5" points={calibration.deciles.filter((d) => d.predicted !== null && d.actual !== null).map((d) => `${d.predicted! * 100},${100 - d.actual! * 100}`).join(" ")} />
            {calibration.deciles.filter((d) => d.predicted !== null && d.actual !== null).map((d) => <circle key={d.bin} cx={d.predicted! * 100} cy={100 - d.actual! * 100} r={Math.min(4, 1 + Math.log10(d.n + 1))} fill="var(--accent-blue)" />)}
          </svg>
        </div>
      </div>
    </div>
  );
}

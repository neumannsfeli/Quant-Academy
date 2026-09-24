"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/lib/client";
import { Button, Label, focusRing } from "./ui";

const OPTIONS = [
  ["next_round", "Passed — through to the next round"],
  ["rejected", "Did not pass"],
  ["waiting", "Still waiting to hear"],
  ["declined", "Rather not say"],
] as const;

/** Frame 20 · Outcome prompt — the calibration pipeline (product spec §14.4). */
export function OutcomePrompt() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [choice, setChoice] = useState<string>("next_round");
  const [firm, setFirm] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-canvas/80 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="outcome-title">
      <div className="w-[520px] bg-surface border border-line-strong rounded-[14px] p-7 flex flex-col gap-4">
        <Label>Your interview date has passed</Label>
        <h2 id="outcome-title" className="text-[20px] font-semibold">How did it go?</h2>
        <input value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="Firm and round (optional), e.g. first round" className={`h-10 bg-inset border border-line rounded-[8px] px-3 text-[13px] ${focusRing}`} />
        <div className="flex flex-col gap-2" role="radiogroup">
          {OPTIONS.map(([v, l]) => (
            <label key={v} className={`flex items-center gap-3 px-4 py-3 rounded-[8px] border text-[13px] cursor-pointer ${choice === v ? "border-blue bg-blue/10" : "border-line bg-inset text-ink-2"}`}>
              <input type="radio" checked={choice === v} onChange={() => setChoice(v)} className="accent-[var(--accent-blue)]" />
              {l}
            </label>
          ))}
        </div>
        <div className="bg-inset rounded-[8px] px-4 py-3 text-[11px] leading-[17px] text-ink-3">
          This is the only way the score can ever be checked against reality. Shared de-identified, used only to calibrate readiness, withdrawable at any time in Settings.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button kind="secondary" onClick={() => setOpen(false)}>Not now</Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await call("/api/me/outcome", { json: { result: choice, firm: firm || null } }).catch(() => {});
              setOpen(false);
              router.replace("/home");
            }}
          >
            Share outcome
          </Button>
        </div>
      </div>
    </div>
  );
}

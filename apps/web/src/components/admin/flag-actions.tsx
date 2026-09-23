"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call, copyFor } from "@/lib/client";
import { Button, Label, focusRing } from "../ui";

/** Retire is corrective and irreversible for scores: it voids every answer and replays θ (product spec §12.4). */
export function FlagActions({ flagId, kind, templateId, responses }: { flagId: string; kind: "item" | "lesson_step"; templateId: string; responses: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function resolve(action: "dismiss" | "retire" | "edit") {
    setBusy(action);
    setMsg(null);
    try {
      const r = await call<{ replayedUsers: number }>("/api/admin/flags", { json: { id: flagId, action } });
      if (action === "edit") router.push(`/admin/templates?id=${encodeURIComponent(templateId)}`);
      else {
        setMsg(action === "retire" ? `Retired. ${r.replayedUsers} users replayed.` : "Dismissed.");
        router.refresh();
      }
    } catch (e) {
      setMsg(copyFor(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="mt-auto bg-surface border border-line rounded-[10px] p-4 flex flex-col gap-3">
      {kind === "item" ? (
        <>
          <Label>Retire — corrective, irreversible for scores</Label>
          <p className="text-[12px] text-ink-2">Voids {responses} response{responses === 1 ? "" : "s"} and replays θ for everyone who answered. The template stops serving immediately; anyone who drops a level sees why.</p>
        </>
      ) : (
        <Label>Resolve</Label>
      )}
      {msg ? <p className="text-[11.5px] text-ready" role="status">{msg}</p> : null}
      <div className="flex gap-2">
        {kind === "item" ? <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="type RETIRE to confirm" aria-label="Type RETIRE to confirm" className={`flex-1 bg-inset border border-line-strong rounded-[8px] px-3 text-[12px] font-mono ${focusRing}`} /> : <span className="flex-1" />}
        <Button kind="secondary" loading={busy === "dismiss"} onClick={() => resolve("dismiss")}>Dismiss</Button>
        {kind === "item" ? <Button kind="secondary" loading={busy === "edit"} onClick={() => resolve("edit")}>Edit → new version</Button> : null}
        {kind === "item" ? <Button kind="danger" loading={busy === "retire"} disabled={confirm !== "RETIRE"} onClick={() => resolve("retire")}>Retire</Button> : null}
      </div>
    </section>
  );
}

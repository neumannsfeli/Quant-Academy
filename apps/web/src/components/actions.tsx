"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { call, copyFor } from "@/lib/client";
import { Button } from "./ui";

/** Starts (or resumes) a session and opens the runner. */
export function StartSession({ mode = "practice", children, kind = "primary", className = "", size }: { mode?: "practice" | "placement" | "assessment" | "review"; children: ReactNode; kind?: "primary" | "secondary" | "ghost"; className?: string; size?: "sm" | "md" | "lg" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={className}>
      <Button
        kind={kind}
        size={size}
        loading={busy}
        className="w-full"
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await call<{ sessionId: string }>("/api/sessions", { json: { mode } });
            router.push(`/session/${r.sessionId}`);
          } catch (e) {
            setErr(copyFor(e));
            setBusy(false);
          }
        }}
      >
        {children}
      </Button>
      {err ? <p className="text-[11px] text-red mt-2">{err}</p> : null}
    </div>
  );
}

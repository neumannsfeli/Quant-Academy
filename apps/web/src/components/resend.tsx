"use client";

import { useEffect, useState } from "react";
import { mmss } from "@/lib/format";
import { resend } from "@/app/(public)/check-email/actions";

export function ResendLink({ email }: { email: string }) {
  const [left, setLeft] = useState(60_000);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1000)), 1000);
    return () => clearInterval(t);
  }, [sent]);
  if (left > 0) return <p className="font-mono text-[11px] text-ink-3">Resend link in {mmss(left)}</p>;
  return (
    <button
      className="font-mono text-[11px] text-blue underline"
      onClick={async () => {
        await resend(email);
        setSent((s) => !s);
        setLeft(60_000);
      }}
    >
      Resend link
    </button>
  );
}

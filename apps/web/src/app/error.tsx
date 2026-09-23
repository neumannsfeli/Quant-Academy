"use client";

import { Button, Logo } from "@/components/ui";

/** Frame 13 · "Something went wrong on our side" — answers already submitted are saved. */
export default function ErrorPage({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo size={36} />
      <h1 className="text-[22px] font-semibold">Something went wrong on our side</h1>
      <p className="text-[13px] text-ink-2 max-w-[400px]">Anything you already submitted is saved. Try again — if it keeps happening, tell us the code below.</p>
      {error.digest ? <p className="font-mono text-[11px] text-ink-3">ref {error.digest}</p> : null}
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <a href="/home" className="px-4 py-2 text-[12.5px] text-ink-2 hover:text-ink">Go to Home</a>
      </div>
    </main>
  );
}

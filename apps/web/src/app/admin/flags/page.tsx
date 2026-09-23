import Link from "next/link";
import { flagQueue } from "@qa/core";
import { FlagActions } from "@/components/admin/flag-actions";
import { Label, Tex, focusRing } from "@/components/ui";
import { requireStaff } from "@/lib/server";

export const metadata = { title: "Flags" };

function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
  return h < 1 ? "just now" : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Frame 26 · Admin — flag queue. Shows exactly what the user saw, rebuilt from the seed. */
export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireStaff(["reviewer", "admin"]);
  const flags = await flagQueue();
  const sp = await searchParams;
  // Group item flags per template; lesson-step flags stand alone.
  const groups = new Map<string, typeof flags>();
  for (const f of flags) {
    const key = f.kind === "item" ? `t:${f.templateId}` : `l:${f.id}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const list = [...groups.entries()].map(([key, fs]) => ({ key, first: fs[0]!, count: fs.length }));
  const sel = list.find((g) => g.first.id === sp.id) ?? list[0];
  const f = sel?.first;

  return (
    <div className="flex-1 flex min-h-0">
      <aside className="w-[300px] shrink-0 border-r border-line p-[14px] flex flex-col gap-2">
        <Label>Open flags · oldest first</Label>
        {list.map((g) => (
          <Link key={g.key} href={`/admin/flags?id=${g.first.id}`} className={`rounded-[8px] border px-3 py-[10px] flex flex-col gap-1 ${focusRing} ${g === sel ? "border-red bg-surface" : "border-transparent bg-surface/60 hover:bg-surface"}`}>
            <span className="font-mono text-[10.5px] text-ink truncate">{g.first.kind === "item" ? g.first.templateId : `${g.first.skillId} · ${g.first.stepId}`}</span>
            {g.first.note ? <span className="text-[11px] text-ink-2 line-clamp-2">“{g.first.note}”</span> : null}
            <span className={`font-mono text-[9.5px] ${g.count > 1 ? "text-red" : "text-ink-3"}`}>{ago(g.first.createdAt)} · {g.count} flag{g.count === 1 ? "" : "s"}</span>
          </Link>
        ))}
        {!list.length ? <p className="text-[11.5px] text-ink-3">No open flags.</p> : null}
      </aside>
      <main className="flex-1 min-w-0 px-6 py-5 flex flex-col gap-4">
        {!f ? (
          <p className="text-[12.5px] text-ink-3 m-auto">Nothing to review.</p>
        ) : f.kind === "item" ? (
          <>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-[15px]">{f.templateId}</h1>
              <span className="font-mono text-[9.5px] bg-elevated rounded px-[6px] py-[3px] text-ink-3">V{f.version}</span>
            </div>
            <section className="bg-surface border border-line rounded-[10px] p-4 flex flex-col gap-3">
              <Label>Exactly what the user saw · reconstructed from seed {f.seed}</Label>
              {f.instance ? (
                <>
                  <Tex as="div" className="text-[14px] leading-[22px]" html={f.instance.stemHtml} />
                  {f.instance.options ? (
                    <ul className="text-[12px] flex flex-col gap-1">
                      {f.instance.options.map((o, i) => <li key={i} className={o.correct ? "text-ready" : "text-ink-2"}><Tex html={o.html} />{o.misconceptionId ? <span className="text-ink-3 font-mono text-[10px]"> · {o.misconceptionId}</span> : null}</li>)}
                    </ul>
                  ) : null}
                  <div className="flex gap-10 text-[11px]">
                    <div><p className="text-ink-3">user answered</p><p className="font-mono text-red text-[13px]">{f.submitted ?? "—"}</p></div>
                    <div><p className="text-ink-3">key</p><Tex className="font-mono text-ready text-[13px]" html={f.instance.answerHtml} /></div>
                  </div>
                  <details className="text-[11.5px] text-ink-2">
                    <summary className="cursor-pointer text-ink-3">Solution shown to the user</summary>
                    <ol className="list-decimal pl-5 mt-2 flex flex-col gap-1">{f.instance.solutionHtml.map((h, i) => <li key={i}><Tex html={h} /></li>)}</ol>
                  </details>
                </>
              ) : (
                <p className="text-[12px] text-ink-3">The template version is no longer loaded; the seed was {f.seed}.</p>
              )}
            </section>
            <section className="bg-surface border border-line rounded-[10px] px-4 py-3 grid grid-cols-3 text-center">
              <div><p className="text-[10.5px] text-ink-3">responses</p><p className="font-mono text-[15px]">{f.responses}</p></div>
              <div><p className="text-[10.5px] text-ink-3">flag rate</p><p className={`font-mono text-[15px] ${f.flagRate && f.flagRate > 0.02 ? "text-working" : ""}`}>{f.flagRate === null ? "—" : `${(f.flagRate * 100).toFixed(1)}%`}</p></div>
              <div><p className="text-[10.5px] text-ink-3">flags on this template</p><p className="font-mono text-[15px] text-red">{sel!.count}</p></div>
            </section>
            {flags.filter((x) => x.kind === "item" && x.templateId === f.templateId && x.note).length > 1 ? (
              <section className="flex flex-col gap-2">
                <Label>All notes</Label>
                {flags.filter((x) => x.kind === "item" && x.templateId === f.templateId && x.note).map((x) => <p key={x.id} className="text-[12px] text-ink-2">“{x.note}” <span className="text-ink-3 text-[10px]">· {ago(x.createdAt)}</span></p>)}
              </section>
            ) : null}
            <FlagActions flagId={f.id} kind="item" templateId={f.templateId ?? ""} responses={f.responses} />
          </>
        ) : (
          <>
            <h1 className="font-mono text-[15px]">{f.skillId} · {f.stepId}</h1>
            <section className="bg-surface border border-line rounded-[10px] p-4 flex flex-col gap-2">
              <Label>Lesson step flag</Label>
              <p className="text-[13px]">{f.lessonTitle} — {f.stepTitle} (v{f.version})</p>
              <p className="text-[12px] text-ink-2">“{f.note ?? "no note"}”</p>
              <Link href={`/learn/${encodeURIComponent(f.skillId ?? "")}?step=${encodeURIComponent(f.stepId ?? "")}&review=1`} className="text-[12px] text-blue underline">Open the step as a learner</Link>
            </section>
            <FlagActions flagId={f.id} kind="lesson_step" templateId="" responses={0} />
          </>
        )}
      </main>
    </div>
  );
}

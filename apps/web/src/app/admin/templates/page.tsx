import Link from "next/link";
import { getContent, getTemplate, listTemplates } from "@qa/core";
import { StatusPill } from "@/components/admin/nav";
import { TemplateEditor } from "@/components/admin/editor";
import { focusRing } from "@/components/ui";
import { requireStaff } from "@/lib/server";

export const metadata = { title: "Templates" };

const FILTERS = [
  ["", "All"],
  ["draft", "Draft"],
  ["in_review", "Review"],
  ["live", "Live"],
] as const;

/** Frame 25 · Admin — template editor. */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; id?: string; new?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const [all, content] = await Promise.all([listTemplates({ status: sp.status || undefined }), getContent()]);
  const q = (sp.q ?? "").trim().toLowerCase();
  const list = all.filter((t) => !q || t.id.toLowerCase().includes(q) || t.skillId.toLowerCase().includes(q)).slice(0, 200);
  const selectedId = sp.new ? null : sp.id ?? list[0]?.id ?? null;
  const detail = selectedId ? await getTemplate(selectedId).catch(() => null) : null;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, status: sp.status, id: sp.id, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/admin/templates?${p}`;
  };

  return (
    <div className="flex-1 flex min-h-0">
      <aside className="w-[250px] shrink-0 border-r border-line bg-surface p-[14px] flex flex-col gap-3">
        <form action="/admin/templates" className="flex flex-col gap-2">
          <label className="label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="id or skill" className={`bg-inset border border-line-strong rounded-[8px] px-3 py-[9px] text-[12.5px] ${focusRing}`} />
          {sp.status ? <input type="hidden" name="status" value={sp.status} /> : null}
        </form>
        <div className="flex gap-1">
          {FILTERS.map(([v, l]) => (
            <Link key={v} href={qs({ status: v || undefined, id: undefined })} className={`font-mono text-[8.5px] tracking-[0.1em] uppercase rounded px-[7px] py-[4px] ${focusRing} ${(sp.status ?? "") === v ? "bg-blue/20 text-blue" : "bg-elevated text-ink-3 hover:text-ink"}`}>
              {l}
            </Link>
          ))}
        </div>
        <ul className="flex-1 overflow-y-auto flex flex-col gap-1 -mx-1 px-1 max-h-[calc(100vh-240px)]">
          {list.map((t) => (
            <li key={t.id}>
              <Link href={qs({ id: t.id, new: undefined })} className={`block rounded-[8px] px-[10px] py-2 border ${focusRing} ${t.id === selectedId ? "border-blue bg-elevated" : "border-transparent hover:bg-elevated/60"}`}>
                <span className="block font-mono text-[10.5px] text-ink truncate">{t.id}</span>
                <span className="flex items-center gap-2 mt-1">
                  <StatusPill status={t.status} />
                  {!t.sweepPassed ? <span className="font-mono text-[8.5px] text-red">SWEEP ✗</span> : null}
                  {t.flags ? <span className="font-mono text-[8.5px] text-red">⚑ {t.flags}</span> : null}
                </span>
              </Link>
            </li>
          ))}
          {!list.length ? <li className="text-[11.5px] text-ink-3 px-2">No templates match.</li> : null}
        </ul>
        <Link href="/admin/templates?new=1" className={`text-center border border-line-strong rounded-[8px] py-[10px] text-[12.5px] text-ink-2 hover:text-ink ${focusRing}`}>+ New template</Link>
      </aside>
      {detail || sp.new ? (
        <TemplateEditor
          key={detail ? `${detail.id}@${detail.latest.version}` : "new"}
          detail={detail}
          role={user.role}
          skills={content.skillList.map((k) => ({ id: k.id, name: k.name }))}
          misconceptions={[...content.misconceptions.values()].map((m) => ({ id: m.id, label: m.label, skillId: m.skillId }))}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-[12.5px] text-ink-3">Select a template, or create one.</div>
      )}
    </div>
  );
}

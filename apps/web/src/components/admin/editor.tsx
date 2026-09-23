"use client";

/**
 * Frame 25 · template editor. Edits a copy of the payload; saving always creates the next
 * version (product spec §16.1). The preview runs the real instance builder on five seeds;
 * the 200-seed sweep runs on save and on request.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { call, copyFor } from "@/lib/client";
import { Button, Label, Tex, focusRing } from "../ui";
import { StatusPill } from "./nav";

type Payload = Record<string, unknown> & { id: string; skill_id: string; band: number; type: string; stem: string; time_limit_sec: number };
type Issue = { severity: string; code: string; message: string; seed?: number };
type Detail = {
  id: string;
  versions: { version: number; status: string; changeClass: string | null; createdAt: string; reviewNote: string | null }[];
  latest: { version: number; status: string; payload: unknown; sweep: { passed: boolean; issues: Issue[]; distinctAnswers: number } | null };
};
type Preview = { seed: number; ok: true; params: Record<string, number>; stemHtml: string; answerHtml: string; options: { html: string; correct: boolean; misconceptionId: string | null }[] | null } | { seed: number; ok: false; error: string };
type Param = { name: string; type: "int" | "float" | "choice"; min?: number; max?: number; step?: number; values?: number[]; labels?: string[] };
type Miss = { expr?: string; label?: string; misconception_id: string };

const field = `bg-inset border border-line-strong rounded-[8px] px-3 py-[9px] text-[12.5px] text-ink ${focusRing}`;
const mono = `${field} font-mono`;

const BLANK: Payload = { id: "skill.id.b2.new-template", version: 1, skill_id: "", band: 2, type: "numeric", stem: "", time_limit_sec: 150, params: [], answer: "", near_miss: [], solution_steps: [] };

export function TemplateEditor({ detail, role, skills, misconceptions }: { detail: Detail | null; role: string; skills: { id: string; name: string }[]; misconceptions: { id: string; label: string; skillId: string }[] }) {
  const router = useRouter();
  const [p, setP] = useState<Payload>(() => {
    const src = (detail?.latest.payload as Payload) ?? { ...BLANK, skill_id: skills[0]?.id ?? "" };
    const { status: _s, version: _v, ...rest } = src as Payload & { status?: string };
    return rest as Payload;
  });
  const [json, setJson] = useState(() => JSON.stringify(p, null, 2));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [seeds, setSeeds] = useState([1, 2, 3, 4, 5]);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [sweep, setSweep] = useState(detail?.latest.sweep ?? null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [changeClass, setChangeClass] = useState<"cosmetic" | "substantive" | "corrective">("substantive");
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState("");

  const status = detail?.latest.status ?? "new";
  const version = detail?.latest.version ?? 0;
  const priorLive = detail?.versions.some((v) => v.status === "live" && v.version !== version) ?? false;
  const reviewer = role === "reviewer" || role === "admin";
  const skillMcs = useMemo(() => misconceptions.filter((m) => m.skillId === p.skill_id || m.id.split(".")[1] === p.skill_id.split(".")[0]), [misconceptions, p.skill_id]);

  function update(patch: Partial<Payload>) {
    const next = { ...p, ...patch } as Payload;
    setP(next);
    setJson(JSON.stringify(next, null, 2));
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await call<{ ok: boolean; error?: string; previews?: Preview[] }>("/api/admin/templates/preview", { json: { payload: { ...p, version: version || 1 }, seeds } });
        if (r.ok) {
          setPreviews(r.previews ?? []);
          setPreviewErr(null);
        } else setPreviewErr(r.error ?? "invalid");
      } catch (e) {
        setPreviewErr(copyFor(e));
      }
    }, 450);
    return () => clearTimeout(t);
  }, [p, seeds, version]);

  async function act(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "ok", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error && "error" in e ? (e as unknown as { error: { message: string } }).error.message : copyFor(e) });
    } finally {
      setBusy(null);
    }
  }

  const params = (p.params as Param[] | undefined) ?? [];
  const misses = ((p.type === "mcq" ? p.distractors : p.near_miss) as Miss[] | undefined) ?? [];
  const missKey = p.type === "mcq" ? "distractors" : "near_miss";

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto px-5 py-4 flex flex-col gap-4 max-h-[calc(100vh-50px)]">
        <div className="flex items-center gap-3">
          {detail ? (
            <h1 className="font-mono text-[15px]">{detail.id}</h1>
          ) : (
            <input aria-label="Template id" value={p.id} onChange={(e) => update({ id: e.target.value })} className={`${mono} w-[380px]`} />
          )}
          {detail ? <span className="font-mono text-[9.5px] bg-elevated rounded px-[6px] py-[3px] text-ink-3">V{version}</span> : null}
          {detail ? <StatusPill status={status} /> : <StatusPill status="draft" />}
        </div>
        {detail?.versions.find((v) => v.version === version)?.reviewNote ? <p className="text-[11.5px] text-working">Reviewer note: {detail.versions.find((v) => v.version === version)!.reviewNote}</p> : null}

        <div className="grid grid-cols-4 gap-3">
          <F label="Skill">
            <select value={p.skill_id} onChange={(e) => update({ skill_id: e.target.value })} className={field}>
              {skills.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </F>
          <F label="Band">
            <select value={p.band} onChange={(e) => update({ band: Number(e.target.value) })} className={field}>
              {[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </F>
          <F label="Type">
            <select value={p.type} onChange={(e) => update({ type: e.target.value })} className={field} disabled={!!detail}>
              {["numeric", "mcq", "symbolic", "multistep", "drill"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </F>
          <F label="Time limit (s)">
            <input type="number" min={10} value={p.time_limit_sec} onChange={(e) => update({ time_limit_sec: Number(e.target.value) })} className={field} />
          </F>
        </div>

        <F label="Stem">
          <textarea rows={3} value={p.stem} onChange={(e) => update({ stem: e.target.value })} className={field} />
        </F>

        <div>
          <Label>Parameters</Label>
          <div className="flex flex-col gap-1 mt-2">
            {params.map((pr, i) => (
              <div key={i} className="grid grid-cols-[80px_90px_1fr_32px] gap-2 bg-surface rounded-[6px] px-2 py-[6px] items-center font-mono text-[11px]">
                <input aria-label="name" value={pr.name} onChange={(e) => update({ params: params.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="bg-transparent text-ink outline-none" />
                <select aria-label="type" value={pr.type} onChange={(e) => update({ params: params.map((x, j) => (j === i ? ({ name: x.name, type: e.target.value, ...(e.target.value === "choice" ? { values: [1, 2] } : { min: 1, max: 10, step: e.target.value === "float" ? 0.1 : 1 }) } as Param) : x)) })} className="bg-transparent text-ink-2 outline-none">
                  <option>int</option><option>float</option><option>choice</option>
                </select>
                {pr.type === "choice" ? (
                  <input aria-label="values" value={(pr.values ?? []).join(", ")} onChange={(e) => update({ params: params.map((x, j) => (j === i ? { ...x, values: e.target.value.split(",").map((v) => Number(v.trim())).filter((v) => !Number.isNaN(v)) } : x)) })} className="bg-transparent text-ink-2 outline-none" />
                ) : (
                  <span className="flex gap-2 text-ink-3">
                    {(["min", "max", "step"] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1">
                        {k}
                        <input aria-label={k} type="number" value={pr[k] ?? ""} onChange={(e) => update({ params: params.map((x, j) => (j === i ? { ...x, [k]: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} className="w-[70px] bg-inset rounded px-1 text-ink-2 outline-none" />
                      </label>
                    ))}
                  </span>
                )}
                <button aria-label="Remove parameter" onClick={() => update({ params: params.filter((_, j) => j !== i) })} className="text-ink-3 hover:text-red">×</button>
              </div>
            ))}
            <button onClick={() => update({ params: [...params, { name: `x${params.length + 1}`, type: "int", min: 1, max: 10 }] })} className="self-start text-[11.5px] text-ink-3 hover:text-ink mt-1">+ parameter</button>
          </div>
        </div>

        <F label="Constraints · one per line">
          <textarea rows={2} value={((p.constraints as string[] | undefined) ?? []).join("\n")} onChange={(e) => update({ constraints: e.target.value.split("\n").filter((l) => l.trim()) })} className={mono} />
        </F>

        {p.type === "numeric" || p.type === "mcq" ? (
          <F label={p.type === "mcq" ? "Answer (expression, or use answer_label in JSON)" : "Answer"}>
            <input value={String(p.answer ?? "")} onChange={(e) => update({ answer: e.target.value })} className={mono} />
          </F>
        ) : p.type === "symbolic" ? (
          <div className="grid grid-cols-[1fr_200px] gap-3">
            <F label="Answer expression">
              <input value={String(p.answer_expr ?? "")} onChange={(e) => update({ answer_expr: e.target.value })} className={mono} />
            </F>
            <F label="Variables">
              <input value={((p.variables as string[] | undefined) ?? []).join(", ")} onChange={(e) => update({ variables: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} className={mono} />
            </F>
          </div>
        ) : (
          <p className="text-[11.5px] text-ink-3">{p.type === "multistep" ? "Checkpoints" : "The drill spec"} are edited in the JSON below.</p>
        )}

        {p.type === "numeric" || p.type === "mcq" ? (
          <div>
            <Label>{p.type === "mcq" ? "Distractors · each bound to a misconception" : "Near misses · each bound to a misconception"}</Label>
            <div className="flex flex-col gap-1 mt-2">
              {misses.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_20px_1fr_24px] gap-2 bg-surface rounded-[6px] px-3 py-[6px] items-center text-[11.5px]">
                  <input aria-label="expression" value={m.expr ?? m.label ?? ""} onChange={(e) => update({ [missKey]: misses.map((x, j) => (j === i ? { ...(x.label !== undefined ? { label: e.target.value } : { expr: e.target.value }), misconception_id: x.misconception_id } : x)) })} className="bg-transparent font-mono text-ink outline-none" />
                  <span className="text-ink-3">→</span>
                  <select aria-label="misconception" value={m.misconception_id} onChange={(e) => update({ [missKey]: misses.map((x, j) => (j === i ? { ...x, misconception_id: e.target.value } : x)) })} className="bg-transparent text-ink-2 outline-none">
                    {!skillMcs.some((x) => x.id === m.misconception_id) ? <option value={m.misconception_id}>{m.misconception_id}</option> : null}
                    {skillMcs.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                  <button aria-label="Remove" onClick={() => update({ [missKey]: misses.filter((_, j) => j !== i) })} className="text-ink-3 hover:text-red">×</button>
                </div>
              ))}
              <button onClick={() => update({ [missKey]: [...misses, { expr: "", misconception_id: skillMcs[0]?.id ?? "" }] })} className="self-start text-[11.5px] text-ink-3 hover:text-ink mt-1">+ {p.type === "mcq" ? "distractor" : "near miss"}</button>
            </div>
          </div>
        ) : null}

        <F label="Solution steps · one per line">
          <textarea rows={3} value={((p.solution_steps as string[] | undefined) ?? []).join("\n")} onChange={(e) => update({ solution_steps: e.target.value.split("\n").filter((l) => l.trim()) })} className={field} />
        </F>

        <details className="bg-surface border border-line rounded-[8px] p-3">
          <summary className="cursor-pointer text-[11.5px] text-ink-2">Full payload (JSON) — every field, including tolerance, derived values, checkpoints and drills</summary>
          <textarea
            rows={16}
            value={json}
            spellCheck={false}
            onChange={(e) => {
              setJson(e.target.value);
              try {
                setP(JSON.parse(e.target.value));
                setJsonErr(null);
              } catch (err) {
                setJsonErr((err as Error).message);
              }
            }}
            className={`${mono} w-full mt-2 text-[11px]`}
            aria-label="Template JSON"
          />
          {jsonErr ? <p className="text-[11px] text-red mt-1">{jsonErr}</p> : null}
        </details>
      </main>

      <aside className="w-[360px] shrink-0 border-l border-line bg-surface p-[18px] flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-50px)]">
        <div className="flex items-center justify-between">
          <Label>Live preview · {seeds.length} seeds</Label>
          <button onClick={() => setSeeds(Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 100000)))} className={`text-[11px] text-blue hover:text-ink rounded ${focusRing}`}>↻ reroll</button>
        </div>
        {previewErr ? <p className="text-[11.5px] text-red bg-red/10 rounded-[6px] px-3 py-2">{previewErr}</p> : null}
        <div className="flex flex-col gap-2">
          {(previews ?? []).map((pv) =>
            pv.ok ? (
              <details key={pv.seed} className="bg-inset rounded-[6px] px-3 py-2">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="font-mono text-[10.5px] text-ink-3 truncate">{Object.entries(pv.params).map(([k, v]) => `${k} ${Number.isInteger(v) ? v : v.toFixed(3)}`).join(" · ") || `seed ${pv.seed}`}</span>
                  <Tex className="font-mono text-[11px] text-ready shrink-0 pl-2" html={pv.answerHtml} />
                </summary>
                <Tex as="div" className="text-[11.5px] text-ink-2 mt-2" html={pv.stemHtml} />
                {pv.options ? (
                  <ul className="mt-2 text-[11px] flex flex-col gap-1">
                    {pv.options.map((o, i) => <li key={i} className={o.correct ? "text-ready" : "text-ink-3"}><Tex html={o.html} />{o.misconceptionId ? ` · ${o.misconceptionId}` : ""}</li>)}
                  </ul>
                ) : null}
              </details>
            ) : (
              <p key={pv.seed} className="bg-red/10 rounded-[6px] px-3 py-2 font-mono text-[10.5px] text-red">seed {pv.seed}: {pv.error}</p>
            ),
          )}
        </div>

        {detail ? (
          <div className={`border rounded-[10px] p-3 flex flex-col gap-2 ${sweep?.passed ? "border-ready/60" : "border-red/60"}`}>
            <div className="flex items-center justify-between">
              <Label color={sweep?.passed ? "var(--level-ready)" : "var(--accent-red)"}>Seed sweep · 200 seeds · v{version}</Label>
              <span className={`font-mono text-[8.5px] rounded px-[6px] py-[3px] ${sweep?.passed ? "bg-ready/15 text-ready" : "bg-red/15 text-red"}`}>{sweep ? (sweep.passed ? "PASS" : "FAIL") : "NOT RUN"}</span>
            </div>
            {sweep ? (
              <>
                <p className="text-[11px] text-ink-2">✓ {sweep.distinctAnswers} distinct answers</p>
                {sweep.issues.length ? sweep.issues.slice(0, 8).map((i, k) => (
                  <p key={k} className={`text-[11px] ${i.severity === "fail" ? "text-red" : "text-working"}`}>{i.severity === "fail" ? "✗" : "!"} {i.code}: {i.message}{i.seed !== undefined ? ` (seed ${i.seed})` : ""}</p>
                )) : <p className="text-[11px] text-ink-2">✓ no issues: finite answers, constraints satisfiable, options distinct, magnitudes sane</p>}
              </>
            ) : null}
            <Button size="sm" kind="secondary" loading={busy === "sweep"} onClick={() => act("sweep", async () => setSweep(await call(`/api/admin/templates/${encodeURIComponent(detail.id)}/sweep?version=${version}`, { method: "POST" })), "Sweep finished")}>
              Run sweep on v{version}
            </Button>
            <p className="text-[10px] text-ink-3">Unsaved edits are previewed above; the sweep runs on the stored version.</p>
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <Label>{status === "in_review" && reviewer ? "Promote" : "Save"}</Label>
          {msg ? <p className={`text-[11.5px] ${msg.tone === "ok" ? "text-ready" : "text-red"}`} role="status">{msg.text}</p> : null}
          {status === "in_review" && reviewer ? (
            <>
              {priorLive ? (
                <>
                  <p className="text-[10.5px] text-ink-3">Replacing a live version needs a change class (product spec §16.2).</p>
                  <select value={changeClass} onChange={(e) => setChangeClass(e.target.value as typeof changeClass)} className={field} aria-label="Change class">
                    <option value="cosmetic">cosmetic — wording only, keeps difficulty</option>
                    <option value="substantive">substantive — resets difficulty</option>
                    <option value="corrective">corrective — voids past answers and replays θ</option>
                  </select>
                  {changeClass === "corrective" ? <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`type "void ${detail!.id}"`} className={mono} aria-label="Confirm" /> : null}
                </>
              ) : (
                <p className="text-[10.5px] text-ink-3">New template — no change class needed.</p>
              )}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the author (send back)" className={field} aria-label="Review note" />
              <div className="grid grid-cols-2 gap-2">
                <Button kind="secondary" loading={busy === "back"} onClick={() => act("back", () => call("/api/admin/review", { json: { id: detail!.id, version, decision: "send_back", note: note || undefined } }), "Sent back to draft")}>Send back</Button>
                <Button loading={busy === "approve"} disabled={!sweep?.passed} onClick={() => act("approve", () => call(`/api/admin/templates/${encodeURIComponent(detail!.id)}/promote`, { json: { version, changeClass: priorLive ? changeClass : null, confirm: confirm || undefined } }), "Promoted to live")}>Approve → live</Button>
              </div>
            </>
          ) : status === "draft" ? (
            <Button kind="secondary" loading={busy === "submit"} disabled={!sweep?.passed} onClick={() => act("submit", () => call(`/api/admin/templates/${encodeURIComponent(detail!.id)}/submit`, { json: { version } }), "Submitted for review")}>
              Submit v{version} for review
            </Button>
          ) : null}
          <Button
            loading={busy === "save"}
            disabled={!!jsonErr}
            onClick={() =>
              act(
                "save",
                async () => {
                  const r = await call<{ id: string }>("/api/admin/templates", { json: p });
                  router.push(`/admin/templates?id=${encodeURIComponent(r.id)}`);
                },
                `Saved as v${version + 1}`,
              )
            }
          >
            Save as v{version + 1}
          </Button>
          <p className="text-[10px] text-ink-3">Saving never edits a live version: it stores the next version as a draft and sweeps it.</p>
        </div>
      </aside>
    </>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

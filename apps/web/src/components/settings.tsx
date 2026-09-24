"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { call, copyFor } from "@/lib/client";
import { Button, Label, focusRing } from "./ui";

type Me = {
  email: string;
  timezone: string;
  archetypeId: string | null;
  interviewDate: string | null;
  prefs: { reviewReminders: boolean; weeklySummary: boolean; shareOutcomes: boolean; dailyMinutes: number };
  archetypes: { id: string; name: string; selectable: boolean }[];
};

const field = `bg-inset border border-line-strong rounded-[8px] px-3 py-[9px] text-[12px] text-ink ${focusRing}`;

/** Frame 12 · Settings. Every control saves on change; there is no Save button to forget. */
export function SettingsForm({ me: initial, timezones }: { me: Me; timezones: string[] }) {
  const router = useRouter();
  const [me, setMe] = useState(initial);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [exporting, setExporting] = useState<"idle" | "busy" | "sent">("idle");
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");

  async function save(patch: Record<string, unknown>) {
    setStatus(null);
    try {
      const next = await call<Me>("/api/me", { method: "PATCH", json: patch });
      setMe(next);
      setStatus({ tone: "ok", text: "Saved" });
      router.refresh();
    } catch (e) {
      setStatus({ tone: "err", text: copyFor(e) });
    }
  }
  const pref = (k: keyof Me["prefs"], v: boolean | number) => save({ prefs: { [k]: v } });

  return (
    <div className="flex flex-col gap-4">
      <div className="h-5 text-[11.5px]" aria-live="polite">
        {status ? <span className={status.tone === "ok" ? "text-ready" : "text-red"}>{status.text}</span> : null}
      </div>
      <Section title="Account" id="account">
        <Row label="Email" help="Sign-in links go here. To change it, contact support.">
          <input className={`${field} w-[220px] text-ink-2`} value={me.email} readOnly aria-label="Email" />
        </Row>
      </Section>

      <Section title="Goal" id="profile">
        <Row label="Firm archetype" help="Sets the domain weights behind your readiness score and which skills count as required.">
          <select className={`${field} w-[220px]`} value={me.archetypeId ?? ""} onChange={(e) => save({ archetypeId: e.target.value })} aria-label="Firm archetype">
            {me.archetypes.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.selectable}>
                {a.name}
                {a.selectable ? "" : " — coming later"}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Interview date" help="Reviews are scheduled to land before this date, not after it.">
          <div className="flex items-center gap-2">
            <input type="date" className={`${field} w-[160px] [color-scheme:dark]`} defaultValue={me.interviewDate ?? ""} onBlur={(e) => e.target.value !== (me.interviewDate ?? "") && save({ interviewDate: e.target.value || null })} aria-label="Interview date" />
            {me.interviewDate ? (
              <button className={`text-[11px] text-ink-3 hover:text-ink rounded ${focusRing}`} onClick={() => save({ interviewDate: null })}>
                Clear
              </button>
            ) : null}
          </div>
        </Row>
      </Section>

      <Section title="Schedule & email" id="schedule">
        <Row label="Timezone" help="Review scheduling and daily targets use this.">
          <select className={`${field} w-[200px]`} value={me.timezone} onChange={(e) => save({ timezone: e.target.value })} aria-label="Timezone">
            {(timezones.includes(me.timezone) ? timezones : [me.timezone, ...timezones]).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Row>
        <Row label="Daily target" help="Sessions are filled to this length using typical solve times, not time limits.">
          <select className={`${field} w-[140px]`} value={me.prefs.dailyMinutes} onChange={(e) => pref("dailyMinutes", Number(e.target.value))} aria-label="Daily target">
            {[15, 20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </Row>
        <Row label="Daily reminder" help="One email when reviews are due. Nothing else.">
          <Toggle label="Daily reminder" on={me.prefs.reviewReminders} onChange={(v) => pref("reviewReminders", v)} />
        </Row>
        <Row label="Weekly summary" help="What moved, what is fading, one line on where you stand.">
          <Toggle label="Weekly summary" on={me.prefs.weeklySummary} onChange={(v) => pref("weeklySummary", v)} />
        </Row>
      </Section>

      <Section title="Your data" id="data">
        <Row label="Export everything" help="Every response, timestamp and score as CSV. Yours, no questions asked. We email a link that works for one hour.">
          <Button
            kind="secondary"
            loading={exporting === "busy"}
            disabled={exporting === "sent"}
            onClick={async () => {
              setExporting("busy");
              try {
                await call("/api/me/export", { method: "POST" });
                setExporting("sent");
              } catch (e) {
                setExporting("idle");
                setStatus({ tone: "err", text: copyFor(e) });
              }
            }}
          >
            {exporting === "sent" ? "Link sent — check your email" : "Download"}
          </Button>
        </Row>
        <Row label="Share interview outcomes" help="Off unless you turn it on. Telling us how a real interview went is what lets the score mean something — shared de-identified, withdrawable at any time.">
          <Toggle label="Share interview outcomes" on={me.prefs.shareOutcomes} onChange={(v) => pref("shareOutcomes", v)} />
        </Row>
        <Row label="Delete account" help="Removes your responses and scores permanently. This cannot be undone.">
          {deleting ? null : (
            <Button kind="ghost" className="!border-red !text-red hover:!bg-red/10" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          )}
        </Row>
        {deleting ? (
          <form
            className="bg-red/5 border border-red/50 rounded-[8px] p-4 flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await call("/api/me", { method: "DELETE", json: { confirm } });
                window.location.href = "/?deleted=1";
              } catch (err) {
                setStatus({ tone: "err", text: copyFor(err) });
              }
            }}
          >
            <p className="text-[12px] text-ink-2">
              Type <span className="font-mono text-ink">{me.email}</span> to confirm. Your answers stay in the item statistics with nothing linking them to you; everything else is deleted.
            </p>
            <div className="flex gap-2">
              <input className={`${field} flex-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type your email to confirm" autoComplete="off" />
              <Button kind="danger" type="submit" disabled={confirm.trim().toLowerCase() !== me.email.toLowerCase()}>
                Delete permanently
              </Button>
              <Button kind="ghost" type="button" onClick={() => setDeleting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Section>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section id={id} className="bg-surface border border-line rounded-[10px] p-5 flex flex-col gap-4 scroll-mt-20">
      <Label>{title}</Label>
      {children}
    </section>
  );
}

function Row({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8">
      <div className="max-w-[620px]">
        <p className="text-[12.5px] text-ink">{label}</p>
        <p className="text-[10.5px] leading-[15px] text-ink-3 mt-[2px]">{help}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative w-[34px] h-[20px] rounded-full transition-colors ${on ? "bg-blue" : "bg-line-strong"} ${focusRing}`}>
      <span className={`absolute top-[3px] size-[14px] rounded-full transition-all ${on ? "left-[17px] bg-canvas" : "left-[3px] bg-ink-3"}`} />
    </button>
  );
}

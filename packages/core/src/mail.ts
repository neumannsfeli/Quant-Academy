/**
 * Product spec §13.1 — four emails and no more (plus the outcome ask and the
 * export link). Local development writes messages to MAIL_DIR so tests and the
 * dev mailbox can read them; production (MAIL_TRANSPORT=ses) sends through SES
 * behind the same interface.
 */
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export type Mail = { to: string; subject: string; html: string; text: string; kind: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class FileMailer implements Mailer {
  constructor(private readonly dir = process.env.MAIL_DIR ?? join(process.cwd(), ".mail")) {}
  async send(mail: Mail) {
    mkdirSync(this.dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(join(this.dir, name), JSON.stringify({ ...mail, sentAt: new Date().toISOString() }, null, 1));
    if (process.env.NODE_ENV !== "test") console.log(`[mail] ${mail.kind} → ${mail.to}: ${mail.subject}`);
  }
  list(): (Mail & { id: string; sentAt: string })[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse()
        .map((f) => ({ id: f, ...JSON.parse(readFileSync(join(this.dir, f), "utf8")) }));
    } catch {
      return [];
    }
  }
}

/** Region and credentials come from the environment (on EC2, the instance role). */
export class SesMailer implements Mailer {
  constructor(
    private readonly client: Pick<SESv2Client, "send"> = new SESv2Client({}),
    private readonly from = config.mailFrom,
    private readonly configurationSet = process.env.SES_CONFIGURATION_SET || undefined,
  ) {}
  async send(mail: Mail) {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [mail.to] },
        ReplyToAddresses: [config.supportEmail],
        ConfigurationSetName: this.configurationSet,
        EmailTags: [{ Name: "kind", Value: mail.kind }],
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: "UTF-8" },
            Body: { Html: { Data: mail.html, Charset: "UTF-8" }, Text: { Data: mail.text, Charset: "UTF-8" } },
          },
        },
      }),
    );
  }
}

let mailer: Mailer | null = null;
export function useMailer(next: Mailer | null) {
  mailer = next;
}
export function getMailer(): Mailer {
  if (!mailer) {
    const transport = process.env.MAIL_TRANSPORT ?? "file";
    if (transport === "ses") mailer = new SesMailer();
    else if (transport === "file") mailer = new FileMailer();
    else throw new Error(`MAIL_TRANSPORT must be "ses" or "file", not "${transport}"`);
  }
  return mailer;
}

// ── Templates ──────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, body: string, footer = true): string {
  return `<!doctype html><html><body style="margin:0;background:#0a0c10;font-family:Inter,Arial,sans-serif;color:#e8ecf4">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c10;padding:32px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#12161f;border:1px solid #232b38;border-radius:12px;padding:32px">
<tr><td style="padding-bottom:20px"><span style="display:inline-block;background:#3dd68c;color:#0a0c10;font-family:'JetBrains Mono',monospace;font-weight:700;border-radius:6px;padding:3px 8px">Q</span>
<span style="font-weight:600;margin-left:8px">Quant Academy</span></td></tr>
<tr><td><h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>${body}</td></tr>
${footer ? `<tr><td style="padding-top:24px;border-top:1px solid #232b38;color:#7a8698;font-size:12px;line-height:18px">
Questions? Reply or write to <a style="color:#5b8cff" href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a> — a person reads it every day.<br>
<a style="color:#7a8698" href="${esc(config.appUrl)}/settings">Email settings</a> · one click to unsubscribe from reminders.</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#5b8cff;color:#0a0c10;text-decoration:none;font-weight:600;border-radius:8px;padding:12px 22px;display:inline-block">${esc(label)}</a></p>`;
const p = (t: string) => `<p style="color:#99a3b8;font-size:14px;line-height:22px;margin:0 0 12px">${t}</p>`;

export const templates = {
  signIn(url: string, isNew: boolean): Omit<Mail, "to"> {
    const title = isNew ? "Welcome — confirm your email" : "Your sign-in link";
    return {
      kind: "verify",
      subject: isNew ? "Confirm your email and start placement" : "Sign in to Quant Academy",
      html: layout(title, p(isNew ? "One click and you are in. The next screen sets your goal; placement takes about 20 minutes and you can stop halfway." : "Use this link to sign in. It works once and expires in 15 minutes.") + button(url, isNew ? "Confirm and continue" : "Sign in") + p("If you did not ask for this, ignore it — nothing happens without a click.")),
      text: `${title}\n\n${url}\n\nThe link works once and expires in 15 minutes.`,
    };
  },
  desktopHandoff(): Omit<Mail, "to"> {
    const url = `${config.appUrl}/signup`;
    return {
      kind: "handoff",
      subject: "Your Quant Academy link for a desktop",
      html: layout("Pick this up on a laptop", p("The practice runner is timed and needs a real keyboard and screen, so it is desktop-only. Open this on a computer when you have 30 minutes.") + button(url, "Open Quant Academy") + p("This is the only email we will send. Your address has already been deleted."), false),
      text: `Open Quant Academy on a desktop: ${url}\n\nThis is the only email we will send; your address has been deleted.`,
    };
  },
  dailyPlan(plan: { minutes: number; reviews: number; lesson: string | null; items: number }): Omit<Mail, "to"> {
    const parts = [plan.lesson ? `a lesson on <strong>${esc(plan.lesson)}</strong>` : null, plan.reviews ? `${plan.reviews} review${plan.reviews === 1 ? "" : "s"} due` : null, plan.items - plan.reviews > 0 ? `${plan.items - plan.reviews} new items` : null].filter(Boolean);
    return {
      kind: "daily-plan",
      subject: plan.lesson && !plan.reviews ? `Today: ${plan.lesson}` : `Today's plan · ${plan.reviews} review${plan.reviews === 1 ? "" : "s"} due`,
      html: layout("Today's plan", p(`About ${plan.minutes} minutes: ${parts.join(", ")}.`) + p("Skills fade on a schedule. A review now keeps what you have proved from slipping.") + button(`${config.appUrl}/home`, "Start today's plan")),
      text: `Today's plan, about ${plan.minutes} minutes: ${parts.join(", ").replace(/<[^>]+>/g, "")}.\n${config.appUrl}/home`,
    };
  },
  weeklySummary(s: { readiness: number | null; delta: number | null; fading: string[]; moved: string[]; weakest: string | null }): Omit<Mail, "to"> {
    const moved = s.moved.length ? `<ul style="color:#99a3b8;font-size:14px">${s.moved.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : p("No level changes this week.");
    return {
      kind: "weekly",
      subject: s.readiness !== null ? `Your week: readiness ${s.readiness}${s.delta ? ` (${s.delta > 0 ? "+" : ""}${s.delta})` : ""}` : "Your week at Quant Academy",
      html: layout("Your week", p("<strong>What moved</strong>") + moved + (s.fading.length ? p(`<strong>Fading:</strong> ${s.fading.map(esc).join(", ")}`) : "") + (s.weakest ? p(`Your weakest link is still ${esc(s.weakest)} — it sets the ceiling.`) : "") + button(`${config.appUrl}/progress`, "See your progress")),
      text: `Readiness ${s.readiness ?? "—"}. Moved: ${s.moved.join("; ") || "none"}. Fading: ${s.fading.join(", ") || "none"}.`,
    };
  },
  outcomeAsk(firm: string | null): Omit<Mail, "to"> {
    return {
      kind: "outcome",
      subject: "How did it go?",
      html: layout("How did it go?", p(`Your interview${firm ? ` with ${esc(firm)}` : ""} was last week. However it went, telling us helps check whether the readiness score means anything — that is the whole point of it.`) + button(`${config.appUrl}/home?outcome=1`, "Tell us in 20 seconds") + p("You agreed to this in Settings; you can turn it off there.")),
      text: `How did your interview go? ${config.appUrl}/home?outcome=1`,
    };
  },
  exportReady(url: string): Omit<Mail, "to"> {
    return {
      kind: "export",
      subject: "Your data export is ready",
      html: layout("Your export is ready", p("A CSV of every answer you have given. The link expires in one hour.") + button(url, "Download CSV")),
      text: `Your export: ${url} (expires in one hour)`,
    };
  },
};

export async function sendMail(to: string, t: Omit<Mail, "to">) {
  await getMailer().send({ to, ...t });
}

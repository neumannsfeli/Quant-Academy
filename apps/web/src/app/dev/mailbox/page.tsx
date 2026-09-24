import { notFound } from "next/navigation";
import { FileMailer } from "@qa/core";

export const dynamic = "force-dynamic";

/** Local development only: read what the file mailer "sent". */
export default function Mailbox() {
  if (process.env.NODE_ENV === "production" && process.env.DEV_MAILBOX !== "on") notFound();
  const mails = new FileMailer().list().slice(0, 30);
  return (
    <div className="max-w-[900px] mx-auto p-10 flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold">Local mailbox</h1>
      <p className="text-[12px] text-ink-3">Messages written by the development mailer (MAIL_DIR). Production sends through SES instead.</p>
      {mails.map((m) => {
        const link = m.text.match(/https?:\/\/\S+/)?.[0];
        return (
          <div key={m.id} className="bg-surface border border-line rounded-[10px] p-4 flex flex-col gap-1">
            <p className="text-[11px] text-ink-3 font-mono">{m.sentAt} · {m.kind} · to {m.to}</p>
            <p className="text-[14px] font-medium">{m.subject}</p>
            {link ? <a className="text-blue text-[12px] break-all underline" href={link} data-testid="mail-link">{link}</a> : null}
          </div>
        );
      })}
    </div>
  );
}

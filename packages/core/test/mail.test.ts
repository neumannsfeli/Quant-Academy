import { afterEach, describe, expect, it } from "vitest";
import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { FileMailer, getMailer, SesMailer, templates, useMailer } from "../src/mail";

describe("SesMailer", () => {
  it("sends the subject, both bodies and the kind tag in one SES call", async () => {
    const sent: SendEmailCommand[] = [];
    const mailer = new SesMailer({ send: async (c: unknown) => void sent.push(c as SendEmailCommand) } as never, "Quant Academy <hello@example.com>");
    await mailer.send({ to: "a@example.com", ...templates.signIn("https://example.com/link", true) });
    expect(sent).toHaveLength(1);
    const input = sent[0]!.input;
    expect(input.FromEmailAddress).toBe("Quant Academy <hello@example.com>");
    expect(input.Destination?.ToAddresses).toEqual(["a@example.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toBeTruthy();
    expect(input.Content?.Simple?.Body?.Html?.Data).toContain("https://example.com/link");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("https://example.com/link");
    expect(input.EmailTags).toEqual([{ Name: "kind", Value: "verify" }]);
  });
});

describe("getMailer", () => {
  const before = process.env.MAIL_TRANSPORT;
  afterEach(() => {
    if (before === undefined) delete process.env.MAIL_TRANSPORT;
    else process.env.MAIL_TRANSPORT = before;
    useMailer(null);
  });
  it("is chosen by MAIL_TRANSPORT", () => {
    useMailer(null);
    process.env.MAIL_TRANSPORT = "ses";
    expect(getMailer()).toBeInstanceOf(SesMailer);
    useMailer(null);
    delete process.env.MAIL_TRANSPORT;
    expect(getMailer()).toBeInstanceOf(FileMailer);
  });
  it("refuses an unknown transport rather than dropping mail", () => {
    useMailer(null);
    process.env.MAIL_TRANSPORT = "smtp";
    expect(() => getMailer()).toThrow(/MAIL_TRANSPORT/);
  });
});

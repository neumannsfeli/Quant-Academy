/** Tech spec §16.3 item 7: configuration from the environment, always. */
export const config = {
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get graderUrl() {
    return process.env.GRADER_URL ?? "";
  },
  get graderTimeoutMs() {
    return Number(process.env.GRADER_TIMEOUT_MS ?? 2000);
  },
  /** Staging and local serve `in_review` templates too; production serves `live` only. */
  get serveUnreviewed() {
    return process.env.SERVE_UNREVIEWED_CONTENT === "true";
  },
  get mailFrom() {
    return process.env.MAIL_FROM ?? "Quant Academy <hello@quantacademy.local>";
  },
  get supportEmail() {
    return process.env.SUPPORT_EMAIL ?? "support@quantacademy.local";
  },
};

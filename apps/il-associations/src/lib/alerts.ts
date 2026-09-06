import { assertFetchableUrl } from "@/lib/importer/fetch-url";

/**
 * Tell somebody when the unattended refresh fails.
 *
 * The weekly job runs on a Friday morning with nobody watching. Every failure
 * it had while being built was silent — the data simply stopped being current,
 * and the only way to find out was to go and read the logs. That is the gap
 * this closes.
 *
 * Two ways to be told, because the friction is all in the setting up and the
 * cheapest one wins:
 *
 *   ALERT_WEBHOOK_URL     an https endpoint that gets a JSON POST. A Teams or
 *                         Slack incoming webhook, or anything that accepts one.
 *   ALERT_RESEND_API_KEY  with ALERT_EMAIL_TO and ALERT_EMAIL_FROM, sends real
 *                         email through Resend's REST API.
 *
 * Both are optional and both can be on. With neither configured this says so
 * on stderr and does nothing else, so a refresh never fails because its
 * alerting was not set up.
 *
 * Nothing here is allowed to change the outcome of a run. An alert that cannot
 * be delivered is reported and swallowed: the import's own error is the thing
 * worth keeping, and burying it under a mail server's timeout would be a poor
 * trade.
 */

export type Alert = {
  subject: string;
  body: string;
};

const TIMEOUT_MS = 15_000;

async function post(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  // The same guard the importer uses: an operator-supplied URL must not become
  // a way to make the server talk to its own network.
  const safe = await assertFetchableUrl(url);
  const response = await fetch(safe, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${safe.host} returned ${response.status} ${response.statusText}`);
  }
}

/** Where an alert would go, for reporting without sending one. */
export function alertChannels(): string[] {
  const channels: string[] = [];
  if ((process.env.ALERT_WEBHOOK_URL ?? "").trim() !== "") channels.push("webhook");
  if (
    (process.env.ALERT_RESEND_API_KEY ?? "").trim() !== "" &&
    (process.env.ALERT_EMAIL_TO ?? "").trim() !== ""
  ) {
    channels.push("email");
  }
  return channels;
}

/**
 * Send an alert on every configured channel.
 *
 * Reports what happened rather than throwing, so a caller already inside a
 * catch block cannot lose the error it was handling.
 */
export async function sendAlert(alert: Alert): Promise<{ sent: string[]; failed: string[] }> {
  const sent: string[] = [];
  const failed: string[] = [];

  const webhook = (process.env.ALERT_WEBHOOK_URL ?? "").trim();
  if (webhook !== "") {
    try {
      // `text` is what Teams and Slack both read; the rest is for anything else.
      await post(webhook, {
        text: `${alert.subject}\n\n${alert.body}`,
        subject: alert.subject,
        body: alert.body,
      });
      sent.push("webhook");
    } catch (error) {
      failed.push(`webhook (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const apiKey = (process.env.ALERT_RESEND_API_KEY ?? "").trim();
  const to = (process.env.ALERT_EMAIL_TO ?? "").trim();
  const from = (process.env.ALERT_EMAIL_FROM ?? "").trim() || "onboarding@resend.dev";
  if (apiKey !== "" && to !== "") {
    try {
      await post(
        "https://api.resend.com/emails",
        {
          from,
          to: to.split(",").map((address) => address.trim()),
          subject: alert.subject,
          text: alert.body,
        },
        { authorization: `Bearer ${apiKey}` },
      );
      sent.push("email");
    } catch (error) {
      failed.push(`email (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return { sent, failed };
}

/**
 * Announce a failed refresh, and say plainly when nobody is listening.
 *
 * The silence is the thing being fixed, so an unconfigured alerter must not be
 * silent about being unconfigured.
 */
export async function alertRefreshFailure(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const when = new Date().toISOString();

  if (alertChannels().length === 0) {
    console.error(
      "No alerting is configured, so this failure reached nobody. Set ALERT_WEBHOOK_URL, " +
        "or ALERT_RESEND_API_KEY with ALERT_EMAIL_TO.",
    );
    return;
  }

  const { sent, failed } = await sendAlert({
    subject: "Illinois associations: the scheduled refresh failed",
    body:
      `The weekly import failed at ${when}.\n\n` +
      `${message}\n\n` +
      "The roster still holds the last good data. A failed run archives nothing and " +
      "changes nothing, so it is safe to leave until somebody looks.\n\n" +
      "The refresh service's container logs carry the full error, and the run is " +
      "recorded under Imports and updates.",
  });

  if (sent.length > 0) console.error(`Failure alert sent via ${sent.join(", ")}.`);
  for (const failure of failed) console.error(`Could not send failure alert via ${failure}`);
}

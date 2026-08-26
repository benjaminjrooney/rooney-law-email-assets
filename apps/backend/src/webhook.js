import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Lob webhook authentication.
 *
 * Lob signs each delivery with `Lob-Signature`, an HMAC-SHA256 (hex) over
 * `${Lob-Signature-Timestamp}.${raw request body}` using the secret shown on
 * the webhook's page in the Lob dashboard. The timestamp is part of the signed
 * input so an old, captured delivery cannot be replayed later.
 *
 * https://help.lob.com/print-and-mail/getting-data-and-results/using-webhooks
 */

/** Lob's recommended replay tolerance. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export function expectedSignature(secret, timestamp, rawBody) {
  const payload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'),
  ]);
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function signaturesMatch(a, b) {
  const bufferA = Buffer.from(String(a), 'utf8');
  const bufferB = Buffer.from(String(b), 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * @returns {{ok: true} | {ok: false, status: number, message: string}}
 */
export function verifyWebhook({ secret, secrets, signature, timestamp, rawBody, now = Date.now(), toleranceMs = DEFAULT_TOLERANCE_MS }) {
  // Lob signs with the secret of whichever webhook delivered the event, so a
  // service receiving both test and live events holds more than one.
  const candidates = (secrets ?? (secret ? [secret] : [])).filter(Boolean);
  if (candidates.length === 0) {
    return { ok: false, status: 503, message: 'LOB_WEBHOOK_SECRET is not configured on the server.' };
  }
  if (!signature || !timestamp) {
    return { ok: false, status: 401, message: 'Missing Lob-Signature or Lob-Signature-Timestamp header.' };
  }

  // Lob sends milliseconds since the epoch as a string.
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, status: 401, message: 'Lob-Signature-Timestamp is not a number.' };
  }
  if (Math.abs(now - sentAt) > toleranceMs) {
    return { ok: false, status: 401, message: 'Webhook timestamp is outside the accepted window.' };
  }
  const matched = candidates.some((candidate) =>
    signaturesMatch(signature, expectedSignature(candidate, timestamp, rawBody)),
  );
  if (!matched) {
    return { ok: false, status: 401, message: 'Webhook signature does not match.' };
  }
  return { ok: true };
}

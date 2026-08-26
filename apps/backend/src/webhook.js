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

function signedPayload(timestamp, rawBody) {
  return Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'),
  ]);
}

export function expectedSignature(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(signedPayload(timestamp, rawBody)).digest('hex');
}

/**
 * The secret is displayed in Lob's dashboard as hex. Whether it is meant as the
 * literal string or as the bytes it encodes is not documented, and getting it
 * wrong fails identically to a forgery, so both are tried. Each remains a full
 * HMAC-SHA256 check — this widens what counts as the key, not what counts as a
 * valid signature.
 */
function keyVariants(secret) {
  const keys = [Buffer.from(secret, 'utf8')];
  if (secret.length % 2 === 0 && /^[0-9a-f]+$/i.test(secret)) {
    keys.push(Buffer.from(secret, 'hex'));
  }
  return keys;
}

/**
 * Lob's timestamp header is documented only as "a string". Seconds and
 * milliseconds are both plausible, and reading seconds as milliseconds puts
 * every delivery decades outside the replay window — rejecting all of them
 * with the same message a forgery gets.
 *
 * @returns {number|null} milliseconds since the epoch
 */
export function timestampToMillis(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  // 1e11 ms is 1973; any epoch value below that is really seconds.
  return value < 1e11 ? value * 1000 : value;
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

  const sentAt = timestampToMillis(timestamp);
  if (sentAt === null) {
    return { ok: false, status: 401, message: 'Lob-Signature-Timestamp is not a number.' };
  }
  if (Math.abs(now - sentAt) > toleranceMs) {
    return { ok: false, status: 401, message: 'Webhook timestamp is outside the accepted window.' };
  }

  // The signature is always computed over the timestamp exactly as sent, never
  // the normalized one.
  const payload = signedPayload(timestamp, rawBody);
  const matched = candidates.some((candidate) =>
    keyVariants(candidate).some((key) =>
      signaturesMatch(signature, createHmac('sha256', key).update(payload).digest('hex')),
    ),
  );
  if (!matched) {
    return { ok: false, status: 401, message: 'Webhook signature does not match.' };
  }
  return { ok: true };
}

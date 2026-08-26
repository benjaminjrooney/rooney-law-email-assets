import test from 'node:test';
import assert from 'node:assert/strict';

import { createHmac } from 'node:crypto';

import { verifyWebhook, expectedSignature, timestampToMillis, DEFAULT_TOLERANCE_MS } from '../src/webhook.js';
import { EventStore, normalizeEvent, describeEventType } from '../src/event-store.js';

const SECRET = 'whsec_example_secret';
const BODY = Buffer.from(JSON.stringify({ id: 'evt_1', event_type: { id: 'letter.delivered' } }));

test('a correctly signed webhook is accepted', () => {
  const now = Date.now();
  const timestamp = String(now);
  const verdict = verifyWebhook({
    secret: SECRET,
    signature: expectedSignature(SECRET, timestamp, BODY),
    timestamp,
    rawBody: BODY,
    now,
  });
  assert.deepEqual(verdict, { ok: true });
});

test('the signature covers both the timestamp and the exact body bytes', () => {
  const now = Date.now();
  const timestamp = String(now);
  const signature = expectedSignature(SECRET, timestamp, BODY);

  const tamperedBody = verifyWebhook({
    secret: SECRET,
    signature,
    timestamp,
    rawBody: Buffer.from(JSON.stringify({ id: 'evt_1', event_type: { id: 'letter.deleted' } })),
    now,
  });
  assert.equal(tamperedBody.ok, false);

  const tamperedTimestamp = verifyWebhook({
    secret: SECRET,
    signature,
    timestamp: String(now - 1000),
    rawBody: BODY,
    now,
  });
  assert.equal(tamperedTimestamp.ok, false);
});

test('a stale delivery is refused so it cannot be replayed', () => {
  const now = Date.now();
  const timestamp = String(now - DEFAULT_TOLERANCE_MS - 1000);
  const verdict = verifyWebhook({
    secret: SECRET,
    signature: expectedSignature(SECRET, timestamp, BODY),
    timestamp,
    rawBody: BODY,
    now,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /outside the accepted window/);
});

test('a wrong secret, missing headers, and no configured secret each fail distinctly', () => {
  const now = Date.now();
  const timestamp = String(now);

  const wrongSecret = verifyWebhook({
    secret: SECRET,
    signature: expectedSignature('another-secret', timestamp, BODY),
    timestamp,
    rawBody: BODY,
    now,
  });
  assert.equal(wrongSecret.status, 401);
  assert.match(wrongSecret.message, /does not match/);

  const missing = verifyWebhook({ secret: SECRET, signature: '', timestamp: '', rawBody: BODY, now });
  assert.equal(missing.status, 401);
  assert.match(missing.message, /Missing Lob-Signature/);

  const unconfigured = verifyWebhook({ secret: '', signature: 'x', timestamp, rawBody: BODY, now });
  assert.equal(unconfigured.status, 503);
  assert.match(unconfigured.message, /LOB_WEBHOOK_SECRET/);

  const emptyList = verifyWebhook({ secrets: [], signature: 'x', timestamp, rawBody: BODY, now });
  assert.equal(emptyList.status, 503);
});

test('either the test or the live webhook secret is accepted', () => {
  // Lob signs with the secret of whichever webhook delivered the event, so the
  // service has to hold both while test and live run side by side.
  const now = Date.now();
  const timestamp = String(now);
  const secrets = ['whsec_test_env', 'whsec_live_env'];

  for (const signing of secrets) {
    const verdict = verifyWebhook({
      secrets,
      signature: expectedSignature(signing, timestamp, BODY),
      timestamp,
      rawBody: BODY,
      now,
    });
    assert.deepEqual(verdict, { ok: true }, `signed with ${signing}`);
  }

  const stranger = verifyWebhook({
    secrets,
    signature: expectedSignature('whsec_someone_else', timestamp, BODY),
    timestamp,
    rawBody: BODY,
    now,
  });
  assert.equal(stranger.ok, false);
});

test('events are normalized from Lob’s shape', () => {
  const event = normalizeEvent({
    id: 'evt_9',
    reference_id: 'ltr_5',
    event_type: { id: 'letter.certified.delivered', resource: 'letters' },
    date_created: '2026-08-25T12:00:00Z',
    body: { id: 'ltr_5', tracking_number: '9407123', to: { name: 'Jane Doe' } },
  });

  assert.equal(event.letterId, 'ltr_5');
  assert.equal(event.eventType, 'letter.certified.delivered');
  assert.equal(event.label, 'Certified: delivered');
  assert.equal(event.notable, true);
  assert.equal(event.trackingNumber, '9407123');
  assert.equal(event.recipient, 'Jane Doe');
});

test('routine events are not flagged as notable', () => {
  assert.equal(normalizeEvent({ event_type: { id: 'letter.in_transit' } }).notable, false);
  assert.equal(normalizeEvent({ event_type: { id: 'letter.returned_to_sender' } }).notable, true);
  assert.equal(describeEventType('letter.certified.pickup_available'), 'Certified: available for pickup');
  assert.equal(describeEventType('letter.something_new'), 'letter.something_new');
});

test('the store keeps the latest event per letter and bounds its memory', async () => {
  const store = new EventStore({ maxEvents: 3 });
  await store.record({ reference_id: 'ltr_1', event_type: { id: 'letter.mailed' } });
  await store.record({ reference_id: 'ltr_1', event_type: { id: 'letter.in_transit' } });
  await store.record({ reference_id: 'ltr_2', event_type: { id: 'letter.delivered' } });
  await store.record({ reference_id: 'ltr_1', event_type: { id: 'letter.delivered' } });

  assert.equal(store.latestFor('ltr_1').eventType, 'letter.delivered');
  assert.equal(store.latestFor('ltr_2').eventType, 'letter.delivered');
  assert.equal(store.latestFor('ltr_missing'), null);
  assert.equal(store.events.length, 3, 'oldest events are dropped');
  assert.equal(store.recent(2).length, 2);
  assert.equal(store.recent(1)[0].eventType, 'letter.delivered', 'newest first');
});

test('a failing event log never breaks recording', async () => {
  const problems = [];
  const store = new EventStore({ logPath: '/nonexistent-directory/events.jsonl', onError: (m) => problems.push(m) });
  const event = await store.record({ reference_id: 'ltr_1', event_type: { id: 'letter.delivered' } });
  assert.equal(event.letterId, 'ltr_1');
  assert.equal(store.latestFor('ltr_1').eventType, 'letter.delivered');
  assert.equal(problems.length, 1);
});

test('a timestamp in seconds is accepted, not read as ancient milliseconds', () => {
  // Lob documents the header only as "a string". Reading seconds as
  // milliseconds puts every delivery decades outside the replay window and
  // rejects it exactly like a forgery.
  const now = Date.now();
  const seconds = String(Math.floor(now / 1000));

  const verdict = verifyWebhook({
    secret: SECRET,
    signature: expectedSignature(SECRET, seconds, BODY),
    timestamp: seconds,
    rawBody: BODY,
    now,
  });
  assert.deepEqual(verdict, { ok: true });

  assert.equal(timestampToMillis('1787840000'), 1787840000000, 'seconds are scaled up');
  assert.equal(timestampToMillis('1787840000000'), 1787840000000, 'milliseconds pass through');
  assert.equal(timestampToMillis('not-a-number'), null);
  assert.equal(timestampToMillis('0'), null);
});

test('a stale delivery is still refused when the timestamp is in seconds', () => {
  const now = Date.now();
  const seconds = String(Math.floor((now - DEFAULT_TOLERANCE_MS - 60_000) / 1000));
  const verdict = verifyWebhook({
    secret: SECRET,
    signature: expectedSignature(SECRET, seconds, BODY),
    timestamp: seconds,
    rawBody: BODY,
    now,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /outside the accepted window/);
});

test('a hex secret is accepted whether Lob signs with the text or the bytes', () => {
  // Lob shows the secret as hex; which of the two it means is undocumented,
  // and guessing wrong fails identically to a forgery.
  const hexSecret = '8ec6f143144de0760d901e868a0b4e7bddaa743a';
  const now = Date.now();
  const timestamp = String(now);
  const payload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), BODY]);

  const asText = createHmac('sha256', Buffer.from(hexSecret, 'utf8')).update(payload).digest('hex');
  const asBytes = createHmac('sha256', Buffer.from(hexSecret, 'hex')).update(payload).digest('hex');
  assert.notEqual(asText, asBytes, 'the two readings really do differ');

  for (const signature of [asText, asBytes]) {
    const verdict = verifyWebhook({ secret: hexSecret, signature, timestamp, rawBody: BODY, now });
    assert.deepEqual(verdict, { ok: true });
  }

  const forged = createHmac('sha256', Buffer.from('deadbeef', 'utf8')).update(payload).digest('hex');
  assert.equal(verifyWebhook({ secret: hexSecret, signature: forged, timestamp, rawBody: BODY, now }).ok, false);
});

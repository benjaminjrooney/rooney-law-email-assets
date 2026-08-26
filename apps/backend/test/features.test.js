/** HTTP-level tests for cancellation, address checking, and tracking. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { LobClient, LobError, summarizeVerification } from '../src/lob.js';
import { EventStore } from '../src/event-store.js';
import { expectedSignature } from '../src/webhook.js';
import { testConfig, startServer, letterForm, FakeLob, VALID_PAYLOAD, TEST_TOKEN } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_secret';

async function withServer(run, { config = testConfig(), lob = new FakeLob(), eventStore } = {}) {
  const store = eventStore ?? new EventStore({});
  const server = await startServer(createApp({ config, lobClient: lob, eventStore: store }));
  try {
    await run({ server, lob, config, store });
  } finally {
    await server.close();
  }
}

/** Post a webhook the way Lob would, signing the exact bytes. */
async function postWebhook(server, payload, { secret = WEBHOOK_SECRET, timestamp = String(Date.now()) } = {}) {
  const raw = JSON.stringify(payload);
  const response = await fetch(`${server.base}/webhooks/lob`, {
    method: 'POST',
    body: raw,
    headers: {
      'Content-Type': 'application/json',
      'Lob-Signature': expectedSignature(secret, timestamp, raw),
      'Lob-Signature-Timestamp': timestamp,
    },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// ------------------------------------------------------------ cancellation --

test('a letter can be canceled inside the window', async () => {
  await withServer(async ({ server, lob }) => {
    const { status, body } = await server.post('/api/letters/ltr_0/cancel');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(lob.canceled, ['ltr_0']);
  });
});

test('cancelling too late explains that the letter is already printing', async () => {
  const lob = new FakeLob({
    onCancel: () => {
      throw new LobError('letter not found', { statusCode: 404 });
    },
  });
  await withServer(
    async ({ server }) => {
      const { status, body } = await server.post('/api/letters/ltr_0/cancel');
      assert.equal(status, 404);
      assert.match(body.error.message, /can no longer be canceled/);
      assert.match(body.error.message, /letter not found/, 'Lob’s own words are kept');
    },
    { lob },
  );
});

test('cancelling requires the API token', async () => {
  await withServer(async ({ server, lob }) => {
    assert.equal((await server.post('/api/letters/ltr_0/cancel', { token: null })).status, 401);
    assert.deepEqual(lob.canceled, []);
  });
});

test('the send date is returned so the pane can show the remaining window', async () => {
  const sendDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const lob = new FakeLob({ respond: (letter, index) => ({ id: `ltr_${index}`, send_date: sendDate, to: letter.to }) });
  await withServer(
    async ({ server }) => {
      const { body } = await server.post('/api/letters', { body: letterForm(VALID_PAYLOAD) });
      assert.equal(body.mailings[0].letter.sendDate, sendDate);
    },
    { lob },
  );
});

// ------------------------------------------------------------ verification --

test('an address check returns deliverability and a standardized address', async () => {
  const lob = new FakeLob({ isLive: true });
  await withServer(
    async ({ server }) => {
      const { status, body } = await server.post('/api/addresses/verify', {
        body: JSON.stringify({ address: VALID_PAYLOAD.to }),
        headers: { 'Content-Type': 'application/json' },
      });

      assert.equal(status, 200);
      assert.equal(body.deliverability, 'deliverable');
      assert.equal(body.usable, true);
      assert.equal(body.standardized.address_line1, '500 W Madison St');
      assert.equal(body.standardized.address_zip, '60661-2511');
      assert.equal(body.testModeLimited, false);
      assert.match(body.message, /USPS can deliver/);
    },
    { lob },
  );
});

test('on a test key an empty verification is reported as unavailable, not undeliverable', async () => {
  const lob = new FakeLob({ isLive: false, onVerify: () => ({ id: 'us_ver_1' }) });
  await withServer(
    async ({ server }) => {
      const { body } = await server.post('/api/addresses/verify', {
        body: JSON.stringify({ address: VALID_PAYLOAD.to }),
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(body.usable, false);
      assert.equal(body.testModeLimited, true);
      assert.notEqual(body.deliverability, 'undeliverable');
      assert.match(body.message, /live Lob key/);
    },
    { lob },
  );
});

test('an incomplete address is rejected before calling Lob', async () => {
  await withServer(async ({ server, lob }) => {
    const { status, body } = await server.post('/api/addresses/verify', {
      body: JSON.stringify({ address: { name: 'Jane Doe' } }),
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(status, 400);
    assert.ok(body.error.details.length > 0);
    assert.equal(lob.verified.length, 0);
  });
});

test('config tells the add-in whether address checking is usable', async () => {
  await withServer(async ({ server }) => {
    const { body } = await server.get('/api/config');
    assert.equal(body.features.addressCheck, false, 'test key cannot verify');
  });

  await withServer(
    async ({ server }) => {
      const { body } = await server.get('/api/config');
      assert.equal(body.features.addressCheck, true);
    },
    { lob: new FakeLob({ isLive: true }) },
  );
});

test('verify-before-send stops an undeliverable batch before anything is mailed', async () => {
  const config = testConfig({ env: { VERIFY_BEFORE_SEND: 'true' } });
  const lob = new FakeLob({
    isLive: true,
    onVerify: (address) =>
      address.name === 'Robert Roe'
        ? { deliverability: 'undeliverable', primary_line: '1 NOWHERE ST', components: { city: 'Chicago', state: 'IL', zip_code: '60606' } }
        : { deliverability: 'deliverable', primary_line: '500 W MADISON ST', components: { city: 'Chicago', state: 'IL', zip_code: '60661' } },
  });

  await withServer(
    async ({ server }) => {
      const { status, body } = await server.post('/api/letters', {
        body: letterForm({
          ...VALID_PAYLOAD,
          cc: [
            {
              name: 'Robert Roe',
              address_line1: '1 Nowhere Street',
              address_city: 'Chicago',
              address_state: 'IL',
              address_zip: '60606',
            },
          ],
        }),
      });

      assert.equal(status, 400);
      assert.match(body.error.message, /Nothing was mailed/);
      assert.match(body.error.details[0], /Robert Roe/);
      assert.equal(lob.calls.length, 0, 'not even the good recipient is mailed');
    },
    { config, lob },
  );
});

test('a verification outage does not block sending', async () => {
  const config = testConfig({ env: { VERIFY_BEFORE_SEND: 'true' } });
  const lob = new FakeLob({
    isLive: true,
    onVerify: () => {
      throw new LobError('verification service unavailable', { statusCode: 503 });
    },
  });

  await withServer(
    async ({ server }) => {
      const { status } = await server.post('/api/letters', { body: letterForm(VALID_PAYLOAD) });
      assert.equal(status, 201, 'Lob still validates the address when the letter is created');
      assert.equal(lob.calls.length, 1);
    },
    { config, lob },
  );
});

test('summarizeVerification maps every deliverability value to plain English', () => {
  const base = { primary_line: '500 W Madison St', components: { city: 'Chicago', state: 'IL', zip_code: '60661' } };
  for (const [value, expected] of [
    ['deliverable', /can deliver/],
    ['deliverable_missing_unit', /suite\/unit is missing/],
    ['deliverable_incorrect_unit', /may not exist/],
    ['deliverable_unnecessary_unit', /not needed/],
    ['undeliverable', /does not recognize/],
  ]) {
    const summary = summarizeVerification({ ...base, deliverability: value });
    assert.match(summary.message, expected, `for ${value}`);
    assert.equal(summary.usable, true);
  }
});

// ---------------------------------------------------------------- tracking --

test('a signed webhook is recorded and surfaced on the letter', async () => {
  const config = testConfig({ env: { LOB_WEBHOOK_SECRET: WEBHOOK_SECRET } });
  await withServer(
    async ({ server, store }) => {
      const posted = await postWebhook(server, {
        id: 'evt_1',
        reference_id: 'ltr_0',
        event_type: { id: 'letter.certified.delivered' },
        date_created: '2026-08-28T15:04:00Z',
        body: { id: 'ltr_0', tracking_number: '9407123', to: { name: 'Jane Doe' } },
      });

      assert.equal(posted.status, 200);
      assert.equal(store.latestFor('ltr_0').label, 'Certified: delivered');

      const letter = await server.get('/api/letters/ltr_0');
      assert.equal(letter.body.lastEvent.eventType, 'letter.certified.delivered');

      const events = await server.get('/api/events');
      assert.equal(events.body.events.length, 1);
      assert.equal(events.body.trackingConfigured, true);
    },
    { config },
  );
});

test('an unsigned or wrongly signed webhook is refused and recorded nowhere', async () => {
  const config = testConfig({ env: { LOB_WEBHOOK_SECRET: WEBHOOK_SECRET } });
  await withServer(
    async ({ server, store }) => {
      const unsigned = await fetch(`${server.base}/webhooks/lob`, {
        method: 'POST',
        body: JSON.stringify({ id: 'evt_2', reference_id: 'ltr_0' }),
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(unsigned.status, 401);

      const wrongSecret = await postWebhook(server, { id: 'evt_3', reference_id: 'ltr_0' }, { secret: 'nope' });
      assert.equal(wrongSecret.status, 401);

      const stale = await postWebhook(
        server,
        { id: 'evt_4', reference_id: 'ltr_0' },
        { timestamp: String(Date.now() - 60 * 60 * 1000) },
      );
      assert.equal(stale.status, 401);

      assert.equal(store.events.length, 0);
    },
    { config },
  );
});

test('webhooks are refused when no secret is configured', async () => {
  await withServer(async ({ server }) => {
    const { status, body } = await postWebhook(server, { id: 'evt_5' });
    assert.equal(status, 503);
    assert.match(body.error.message, /LOB_WEBHOOK_SECRET/);
  });
});

test('recent mailings come from Lob and carry the latest tracking event', async () => {
  const config = testConfig({ env: { LOB_WEBHOOK_SECRET: WEBHOOK_SECRET } });
  await withServer(
    async ({ server }) => {
      await postWebhook(server, {
        id: 'evt_6',
        reference_id: 'ltr_0',
        event_type: { id: 'letter.certified.delivered' },
        body: { id: 'ltr_0' },
      });

      const { status, body } = await server.get('/api/mailings?limit=2');
      assert.equal(status, 200);
      assert.equal(body.mailings.length, 2);
      assert.equal(body.mailings[0].id, 'ltr_0');
      assert.equal(body.mailings[0].lastEvent.label, 'Certified: delivered');
      assert.equal(body.mailings[0].trackingNumber, '9407123');
      assert.equal(body.mailings[1].lastEvent, null, 'no event yet for the second letter');
      assert.equal(body.trackingConfigured, true);
    },
    { config },
  );
});

// -------------------------------------------------------- cost estimation --

/** Illustrative rates only — the real ones come from the firm's Lob invoice. */
const RATE_ENV = {
  RATE_BASE: '1.00',
  RATE_EXTRA_PAGE: '0.10',
  RATE_CERTIFIED: '5.55',
  RATE_CERTIFIED_RETURN_RECEIPT: '8.46',
};

test('an estimate prices the send without creating anything', async () => {
  const config = testConfig({ env: RATE_ENV });
  await withServer(
    async ({ server, lob }) => {
      const { status, body } = await server.post('/api/estimate', {
        body: letterForm({
          ...VALID_PAYLOAD,
          mailClass: 'certified_return_receipt',
          cc: [
            {
              name: 'Robert Roe',
              address_line1: '1 North Wacker Drive',
              address_city: 'Chicago',
              address_state: 'IL',
              address_zip: '60606',
              mailClass: 'regular',
            },
          ],
        }),
      });

      assert.equal(status, 200);
      assert.equal(body.pages, 1);
      assert.equal(body.mailings.length, 2);
      // Certified: 1.00 + 8.46, no address page. Regular CC: 1.00 + the
      // inserted address page at 0.10.
      assert.equal(body.mailings[0].estimate.total, 9.46);
      assert.equal(body.mailings[1].estimate.total, 1.1);
      assert.equal(body.total.total, 10.56);
      assert.equal(body.total.letters, 2);

      assert.equal(lob.calls.length, 0, 'estimating never touches Lob');
    },
    { config },
  );
});

test('without configured rates the estimate is withheld, not guessed', async () => {
  await withServer(async ({ server }) => {
    const { status, body } = await server.post('/api/estimate', { body: letterForm(VALID_PAYLOAD) });
    assert.equal(status, 200);
    assert.equal(body.total.available, false);
    assert.equal(body.total.total, null);
    assert.match(body.mailings[0].estimate.notes[0], /not configured/);

    const config = await server.get('/api/config');
    assert.equal(config.body.features.costEstimate, false);
  });
});

test('estimating validates the same way sending does', async () => {
  await withServer(async ({ server }) => {
    const bad = await server.post('/api/estimate', { body: letterForm({ to: { name: 'Jane Doe' } }) });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.details.length >= 3);

    assert.equal((await server.post('/api/estimate', { body: letterForm(VALID_PAYLOAD), token: null })).status, 401);
  });
});

test('a sent letter carries the same estimate back', async () => {
  const config = testConfig({ env: RATE_ENV });
  await withServer(
    async ({ server }) => {
      const { status, body } = await server.post('/api/letters', {
        body: letterForm({ ...VALID_PAYLOAD, mailClass: 'certified' }),
      });
      assert.equal(status, 201);
      assert.equal(body.mailings[0].estimate.total, 6.55);
      assert.equal(body.total.total, 6.55);
      assert.equal(body.total.letters, 1);
    },
    { config },
  );
});

test('a failed copy is left out of the total', async () => {
  const config = testConfig({ env: RATE_ENV });
  const lob = new FakeLob({
    respond: (letter, index) => {
      if (letter.to.name === 'Robert Roe') throw new LobError('undeliverable', { statusCode: 422 });
      return { id: `ltr_${index}`, to: letter.to };
    },
  });

  await withServer(
    async ({ server }) => {
      const { status, body } = await server.post('/api/letters', {
        body: letterForm({
          ...VALID_PAYLOAD,
          cc: [
            {
              name: 'Robert Roe',
              address_line1: '1 North Wacker Drive',
              address_city: 'Chicago',
              address_state: 'IL',
              address_zip: '60606',
            },
          ],
        }),
      });

      assert.equal(status, 207);
      assert.equal(body.total.letters, 1, 'only the letter that went out is priced');
      assert.equal(body.total.total, 1.1);
    },
    { config, lob },
  );
});

test('a billing group is passed through to Lob for per-matter invoicing', async () => {
  await withServer(async ({ server, lob }) => {
    const { status } = await server.post('/api/letters', {
      body: letterForm({ ...VALID_PAYLOAD, billingGroupId: 'bg_matter_2026_014' }),
    });
    assert.equal(status, 201);
    assert.equal(lob.calls[0].billingGroupId, 'bg_matter_2026_014');
  });
});

test('a malformed billing group is rejected', async () => {
  await withServer(async ({ server, lob }) => {
    const { status, body } = await server.post('/api/letters', {
      body: letterForm({ ...VALID_PAYLOAD, billingGroupId: 'not a valid id!' }),
    });
    assert.equal(status, 400);
    assert.match(body.error.message, /billingGroupId/);
    assert.equal(lob.calls.length, 0);
  });
});

// ------------------------------------------------- upstream vs client auth --

test('a bad Lob key does not make the add-in ask for its own token again', async () => {
  // A real LobClient, so the 401 travels the same path a live misconfiguration
  // would: Lob rejects the server's key mid-send.
  const lob = new LobClient({
    apiKey: 'live_wrong',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Your API key is not valid' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  });

  const server = await startServer(createApp({ config: testConfig(), lobClient: lob }));
  try {
    const { status, body } = await server.post('/api/letters', { body: letterForm(VALID_PAYLOAD) });

    assert.notEqual(status, 401, 'a 401 here would make the task pane re-prompt for the access token');
    assert.notEqual(status, 403);
    assert.equal(status, 502);
    assert.match(body.error.message, /LOB_API_KEY/);
  } finally {
    await server.close();
  }
});

test('recent mailings need the API token', async () => {
  await withServer(async ({ server }) => {
    assert.equal((await server.get('/api/mailings', { token: null })).status, 401);
    assert.equal((await server.get('/api/events', { token: null })).status, 401);
    assert.equal((await server.get('/api/mailings', { token: TEST_TOKEN })).status, 200);
  });
});

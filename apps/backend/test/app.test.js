import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { LobError } from '../src/lob.js';
import { LetterRateLimiter } from '../src/rate-limit.js';
import { testConfig, startServer, letterForm, samplePdf, FakeLob, VALID_PAYLOAD, TEST_TOKEN } from './helpers.js';

async function withServer(run, { config = testConfig(), lob = new FakeLob(), rateLimiter } = {}) {
  const server = await startServer(createApp({ config, lobClient: lob, rateLimiter }));
  try {
    await run({ server, lob, config });
  } finally {
    await server.close();
  }
}

test('healthz is public and reports configuration problems', async () => {
  await withServer(async ({ server }) => {
    const { status, body } = await server.get('/healthz', { token: null });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.lobMode, 'test');
    assert.deepEqual(body.problems, []);
  });

  const broken = testConfig({ env: { LOB_API_KEY: '', RETURN_ADDRESS_ZIP: '' } });
  await withServer(
    async ({ server }) => {
      const { body } = await server.get('/healthz', { token: null });
      assert.equal(body.ok, false);
      assert.equal(body.configured.lobApiKey, false);
      assert.ok(body.problems.some((problem) => /LOB_API_KEY/.test(problem)));
    },
    { config: broken },
  );
});

test('health is a public alias for healthz', async () => {
  await withServer(async ({ server }) => {
    const alias = await server.get('/health', { token: null });
    const canonical = await server.get('/healthz', { token: null });
    assert.equal(alias.status, 200);
    assert.deepEqual(alias.body, canonical.body);
  });
});

test('the API rejects missing and wrong tokens', async () => {
  await withServer(async ({ server }) => {
    assert.equal((await server.get('/api/config', { token: null })).status, 401);
    assert.equal((await server.get('/api/config', { token: 'wrong' })).status, 401);
    assert.equal((await server.get('/api/config')).status, 200);
  });
});

test('config exposes defaults and mail classes but never the Lob key', async () => {
  await withServer(async ({ server }) => {
    const { body } = await server.get('/api/config');
    assert.equal(body.returnAddress.company, 'Rooney Law');
    assert.equal(body.defaults.addressPlacement, 'insert_blank_page');
    assert.deepEqual(
      body.mailClasses.map((entry) => entry.id),
      ['regular', 'certified', 'certified_return_receipt', 'registered'],
    );
    assert.equal(JSON.stringify(body).includes('test_abc123'), false);
  });
});

test('a valid letter is created and summarized back to the add-in', async () => {
  await withServer(async ({ server, lob }) => {
    const { status, body } = await server.post('/api/letters', {
      body: letterForm({ ...VALID_PAYLOAD, mailClass: 'certified_return_receipt' }),
    });

    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'test');
    assert.equal(body.pages, 1);
    assert.equal(body.mailings.length, 1);
    assert.equal(body.mailings[0].role, 'to');
    assert.equal(body.mailings[0].letter.id, 'ltr_0');
    assert.equal(body.mailings[0].letter.trackingNumber, '94070');

    assert.equal(lob.calls.length, 1);
    const call = lob.calls[0];
    assert.equal(call.extraService, 'certified_return_receipt');
    assert.equal(call.mailType, 'usps_first_class');
    assert.equal(call.addressPlacement, null);
    assert.equal(call.useType, 'operational');
    assert.equal(call.from.company, 'Rooney Law');
    assert.equal(call.metadata.role, 'to');
    assert.match(call.description, /Jane Doe/);
    assert.ok(call.idempotencyKey.endsWith(':0'));
  });
});

test('each CC becomes its own letter with the same PDF', async () => {
  await withServer(async ({ server, lob }) => {
    const { status, body } = await server.post('/api/letters', {
      body: letterForm({
        ...VALID_PAYLOAD,
        mailClass: 'certified',
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

    assert.equal(status, 201);
    assert.equal(body.mailings.length, 2);
    assert.equal(lob.calls.length, 2);
    assert.equal(lob.calls[0].extraService, 'certified');
    assert.equal(lob.calls[1].extraService, null);
    assert.equal(lob.calls[1].addressPlacement, 'insert_blank_page');
    assert.equal(lob.calls[1].to.name, 'Robert Roe');
    assert.equal(lob.calls[1].metadata.role, 'cc');
    assert.notEqual(lob.calls[0].idempotencyKey, lob.calls[1].idempotencyKey);
    // Same document for both mailings.
    assert.deepEqual(lob.calls[0].file.buffer, lob.calls[1].file.buffer);
  });
});

test('a failed CC is reported without hiding the successful main letter', async () => {
  const lob = new FakeLob({
    respond: (letter, index) => {
      if (letter.to.name === 'Robert Roe') throw new LobError('address is undeliverable', { statusCode: 422 });
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
      assert.equal(body.ok, false);
      assert.equal(body.mailings[0].ok, true);
      assert.equal(body.mailings[1].ok, false);
      assert.match(body.mailings[1].error.message, /undeliverable/);
    },
    { lob },
  );
});

test('a failed main letter is a plain error, and no CC is attempted', async () => {
  const lob = new FakeLob({
    respond: () => {
      throw new LobError('to.address_zip is not a valid zip', { statusCode: 422 });
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

      assert.equal(status, 422);
      assert.match(body.error.message, /not a valid zip/);
      assert.equal(lob.calls.length, 1, 'the CC copy is not mailed when the main letter fails');
    },
    { lob },
  );
});

test('validation errors come back with every problem listed', async () => {
  await withServer(async ({ server, lob }) => {
    const { status, body } = await server.post('/api/letters', {
      body: letterForm({ to: { name: 'Jane Doe' } }),
    });
    assert.equal(status, 400);
    assert.ok(body.error.details.length >= 3);
    assert.equal(lob.calls.length, 0);
  });
});

test('non-PDF uploads and missing files are refused', async () => {
  await withServer(async ({ server, lob }) => {
    const notPdf = letterForm(VALID_PAYLOAD, { pdf: Buffer.from('PK this is a docx') });
    const rejected = await server.post('/api/letters', { body: notPdf });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error.message, /not a PDF/);

    const form = new FormData();
    form.append('payload', JSON.stringify(VALID_PAYLOAD));
    const missing = await server.post('/api/letters', { body: form });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error.message, /No PDF/);

    assert.equal(lob.calls.length, 0);
  });
});

test('malformed payload JSON is reported clearly', async () => {
  await withServer(async ({ server }) => {
    const form = new FormData();
    form.append('payload', '{not json');
    form.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), 'letter.pdf');
    const { status, body } = await server.post('/api/letters', { body: form });
    assert.equal(status, 400);
    assert.match(body.error.message, /not valid JSON/);
  });
});

test('documents beyond the Lob page limit are refused before upload', async () => {
  await withServer(async ({ server, lob }) => {
    const { status, body } = await server.post('/api/letters', {
      body: letterForm(VALID_PAYLOAD, { pdf: samplePdf(75) }),
    });
    assert.equal(status, 400);
    assert.match(body.error.message, /about 75 pages/);
    assert.equal(lob.calls.length, 0);
  });
});

test('the spend limit stops a runaway batch', async () => {
  const rateLimiter = new LetterRateLimiter({ maxPerHour: 2, maxPerDay: 10 });
  await withServer(
    async ({ server, lob }) => {
      assert.equal((await server.post('/api/letters', { body: letterForm(VALID_PAYLOAD) })).status, 201);
      assert.equal((await server.post('/api/letters', { body: letterForm(VALID_PAYLOAD) })).status, 201);

      const blocked = await server.post('/api/letters', { body: letterForm(VALID_PAYLOAD) });
      assert.equal(blocked.status, 429);
      assert.match(blocked.body.error.message, /Hourly limit/);
      assert.equal(lob.calls.length, 2);
    },
    { rateLimiter },
  );
});

test('letter status can be looked up for certified tracking', async () => {
  await withServer(async ({ server }) => {
    const { status, body } = await server.get('/api/letters/ltr_123');
    assert.equal(status, 200);
    assert.equal(body.letter.id, 'ltr_123');
    assert.equal(body.status, 'processed');
  });
});

test('the task pane is served from the same origin as the API', async () => {
  await withServer(async ({ server }) => {
    const page = await fetch(`${server.base}/addin/taskpane.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Mail this letter/);

    const module = await fetch(`${server.base}/addin/js/parse-letter.js`);
    assert.equal(module.status, 200);

    const icon = await fetch(`${server.base}/addin/assets/icon-32.png`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
  });
});

test('unknown routes return JSON, not an HTML error page', async () => {
  await withServer(async ({ server }) => {
    const { status, body } = await server.get('/api/nope');
    assert.equal(status, 404);
    assert.match(body.error.message, /No route for GET \/api\/nope/);
  });
});

test('the token also works in the X-Api-Token header', async () => {
  await withServer(async ({ server }) => {
    const response = await fetch(`${server.base}/api/config`, { headers: { 'X-Api-Token': TEST_TOKEN } });
    assert.equal(response.status, 200);
  });
});

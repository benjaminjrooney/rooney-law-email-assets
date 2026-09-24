import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { MAX_PARSE_TEXT_CHARS } from '../src/parse.js';
import { testConfig, startServer, FakeLob } from './helpers.js';

/**
 * POST /api/parse — the recipient block of a letter, read by the add-in's own
 * parser, for PLEJ's mailing dialog to pre-fill (PLEJ decisions M-02, M-03).
 *
 * The request shape is what PLEJ's `parseRecipients` sends
 * (`packages/mail/src/mailServiceClient.ts`): `POST` with a bearer token and a
 * JSON body `{ text }`, the text cut to 4,000 characters. The reply shape is
 * what that function reads back: `{ recipient?, cc[], mailClass?, subject? }`,
 * each address `{ name, company?, line1, line2?, city, state, zip }`, where an
 * address missing any required field is discarded rather than half-filled.
 *
 * The text below is shaped like PLEJ's extracted text of a filed PDF once each
 * visual line is kept as a line (PLEJ M-14): the letterhead is in the body,
 * not a Word header; there are no blank paragraphs; the state is spelled out;
 * the signature block carries the firm's own address. Every name and address is
 * synthetic.
 */
const FILED_PDF_TEXT = [
  'Rooney Law, P.C.',
  '123 North LaSalle Street, Suite 1200',
  'Chicago, Illinois 60602',
  '☎ Tel: 555.000.0000 ☎ Direct: 555.000.0001 ✉ someone@example.test ⊕ example.test',
  'September 2, 2026',
  'VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED',
  'Dana Sample',
  'Sample Holdings, LLC',
  '100 Example Avenue, Suite 200',
  'Springfield, Illinois 62700',
  'Re: Sample Holdings v. Example Builders',
  'Dear Ms. Sample:',
  'This firm represents Example Builders, LLC regarding the contract for the property',
  'located at 7 Other Road, Othertown, Illinois 60002. Please direct all further',
  'communication to me.',
  'Sincerely,',
  'Benjamin J. Rooney',
  'Rooney Law, P.C.',
  '123 North LaSalle Street, Suite 1200',
  'Chicago, Illinois 60602',
  '',
  'cc: Robin Example (via regular mail)',
  'Example Builders, LLC',
  '9 Sample Court',
  'Othertown, Illinois 60002',
].join('\n');

async function withServer(run, { config = testConfig() } = {}) {
  const server = await startServer(createApp({ config, lobClient: new FakeLob() }));
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

function postText(server, text, options = {}) {
  return server.post('/api/parse', {
    body: JSON.stringify({ text }),
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
}

/** Everything the process writes to stdout while `run` is in flight. */
async function captureStdout(run) {
  const written = [];
  const original = process.stdout.write;
  process.stdout.write = function capture(chunk, ...rest) {
    written.push(String(chunk));
    return original.call(this, chunk, ...rest);
  };
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return written.join('');
}

test('parse reads the recipient, mail class, subject and CC of a filed letter', async () => {
  await withServer(async (server) => {
    const { status, body } = await postText(server, FILED_PDF_TEXT);
    assert.equal(status, 200);
    assert.deepEqual(body, {
      recipient: {
        name: 'Dana Sample',
        company: 'Sample Holdings, LLC',
        line1: '100 Example Avenue, Suite 200',
        city: 'Springfield',
        state: 'IL',
        zip: '62700',
      },
      cc: [
        {
          name: 'Robin Example',
          company: 'Example Builders, LLC',
          line1: '9 Sample Court',
          city: 'Othertown',
          state: 'IL',
          zip: '60002',
        },
      ],
      mailClass: 'certified_return_receipt',
      subject: 'Sample Holdings v. Example Builders',
    });
  });
});

test('parse requires the same API token as /api/letters', async () => {
  await withServer(async (server) => {
    assert.equal((await postText(server, FILED_PDF_TEXT, { token: null })).status, 401);
    assert.equal((await postText(server, FILED_PDF_TEXT, { token: 'wrong' })).status, 401);
    // Positive control: the right token is answered.
    assert.equal((await postText(server, FILED_PDF_TEXT)).status, 200);
  });
});

test('parse refuses every request when the server has no API token', async () => {
  await withServer(
    async (server) => {
      assert.equal((await postText(server, FILED_PDF_TEXT)).status, 503);
    },
    { config: testConfig({ env: { API_TOKEN: '' } }) },
  );
});

test('a letter addressed to a company alone names the company', async () => {
  // PLEJ requires `name` and discards an address without one, so a company-only
  // addressee is sent as the name rather than lost.
  const text = [
    'September 2, 2026',
    'VIA FIRST-CLASS MAIL',
    'Example Property Management, Inc.',
    '55 Sample Drive',
    'Suite 3100',
    'Springfield, IL 62701',
    'Dear Sir or Madam:',
  ].join('\n');
  await withServer(async (server) => {
    const { body } = await postText(server, text);
    assert.deepEqual(body.recipient, {
      name: 'Example Property Management, Inc.',
      line1: '55 Sample Drive',
      line2: 'Suite 3100',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
    });
    assert.equal(body.mailClass, 'regular');
  });
});

test('no mail class is suggested when the letter names none', async () => {
  // The parser defaults to regular mail when it cannot tell; passing that on
  // would pre-select a class as though the letter had said so.
  const text = FILED_PDF_TEXT.replace('VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED\n', '');
  await withServer(async (server) => {
    const { status, body } = await postText(server, text);
    assert.equal(status, 200);
    assert.equal('mailClass' in body, false);
    // Positive control: the recipient is still read from the same letter.
    assert.equal(body.recipient.name, 'Dana Sample');
  });
});

test('a document that is not a letter yields no recipient, not an error', async () => {
  await withServer(async (server) => {
    const { status, body } = await postText(
      server,
      'EXHIBIT A\nPurchase agreement, executed copy\nPage 1 of 12',
    );
    assert.equal(status, 200);
    assert.deepEqual(body, { cc: [] });
  });
});

test('a CC with no address is left out rather than half-filled', async () => {
  const text = `${FILED_PDF_TEXT.split('\ncc:')[0]}\ncc: Client`;
  await withServer(async (server) => {
    const { body } = await postText(server, text);
    assert.deepEqual(body.cc, []);
    assert.equal(body.recipient.name, 'Dana Sample');
  });
});

test('the reply is never cached', async () => {
  await withServer(async (server) => {
    const response = await fetch(`${server.base}/api/parse`, {
      method: 'POST',
      body: JSON.stringify({ text: FILED_PDF_TEXT }),
      headers: { Authorization: `Bearer ${testConfig().apiToken}`, 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('text must be a string', async () => {
  await withServer(async (server) => {
    for (const body of [{}, { text: 42 }, { text: ['a'] }, []]) {
      const reply = await server.post('/api/parse', {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(reply.status, 400, JSON.stringify(body));
    }
  });
});

test('text past the ceiling is refused as too large', async () => {
  await withServer(async (server) => {
    assert.equal((await postText(server, 'a'.repeat(MAX_PARSE_TEXT_CHARS + 1))).status, 413);
    // Positive control: exactly at the ceiling is read.
    assert.equal((await postText(server, 'a'.repeat(MAX_PARSE_TEXT_CHARS))).status, 200);
  });
});

test('hostile text at the ceiling is answered promptly', async () => {
  // The parser's line patterns are quadratic at worst on a long line of short
  // words; the ceiling is what bounds that. Measured at roughly 35 ms here.
  const hostile = [
    'a '.repeat(MAX_PARSE_TEXT_CHARS / 2 - 3) + '12345x',
    'certified mail '.repeat(Math.floor(MAX_PARSE_TEXT_CHARS / 15)),
  ];
  await withServer(async (server) => {
    for (const text of hostile) {
      const started = performance.now();
      const { status } = await postText(server, text.slice(0, MAX_PARSE_TEXT_CHARS));
      assert.equal(status, 200);
      assert.ok(performance.now() - started < 2_000, 'parse took longer than two seconds');
    }
  });
});

test('neither the text nor the address read from it is ever logged', async () => {
  const marker = 'Zyxwvut Sample';
  const text = FILED_PDF_TEXT.replace('Dana Sample', marker);
  await withServer(async (server) => {
    const output = await captureStdout(async () => {
      const { body } = await postText(server, text);
      // Positive control: the marker really was read out as the recipient.
      assert.equal(body.recipient.name, marker);
      // Malformed JSON: Node quotes the start of the body in its SyntaxError.
      const malformed = await server.post('/api/parse', {
        body: `${marker} is not JSON`,
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(malformed.status, 400);
    });
    assert.ok(!output.includes(marker), 'the letter text reached the log');
    assert.ok(!output.includes('Zyxwvut'), 'part of the letter text reached the log');
    // Positive control: the capture itself works — the refusal was logged.
    assert.match(output, /request\.rejected/);
  });
});

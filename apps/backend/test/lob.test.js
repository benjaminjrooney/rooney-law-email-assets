import test from 'node:test';
import assert from 'node:assert/strict';

import { LobClient, LobError, summarizeLetter } from '../src/lob.js';
import { samplePdf } from './helpers.js';

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const LETTER = {
  to: { name: 'Jane Doe', address_line1: '500 W Madison St', address_city: 'Chicago', address_state: 'IL', address_zip: '60661', address_country: 'US' },
  from: { company: 'Rooney Law', address_line1: '123 N LaSalle St', address_city: 'Chicago', address_state: 'IL', address_zip: '60602', address_country: 'US' },
  file: { buffer: samplePdf(), filename: 'letter.pdf' },
  mailType: 'usps_first_class',
  extraService: 'certified_return_receipt',
  color: false,
  doubleSided: true,
  addressPlacement: null,
  description: 'Demand letter',
  useType: 'operational',
  metadata: { matter: '2026-014' },
  idempotencyKey: 'key-1',
};

test('createLetter posts the PDF and addresses as multipart form fields', async () => {
  const seen = {};
  const client = new LobClient({
    apiKey: 'test_key',
    fetchImpl: async (url, options) => {
      seen.url = url;
      seen.options = options;
      return jsonResponse(200, { id: 'ltr_1' });
    },
  });

  await client.createLetter(LETTER);

  assert.equal(seen.url, 'https://api.lob.com/v1/letters');
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers.Authorization, `Basic ${Buffer.from('test_key:').toString('base64')}`);
  assert.equal(seen.options.headers['Idempotency-Key'], 'key-1');

  const form = seen.options.body;
  assert.equal(form.get('to[name]'), 'Jane Doe');
  assert.equal(form.get('to[address_zip]'), '60661');
  assert.equal(form.get('from[company]'), 'Rooney Law');
  assert.equal(form.get('mail_type'), 'usps_first_class');
  assert.equal(form.get('extra_service'), 'certified_return_receipt');
  assert.equal(form.get('color'), 'false');
  assert.equal(form.get('double_sided'), 'true');
  assert.equal(form.get('use_type'), 'operational');
  assert.equal(form.get('description'), 'Demand letter');
  assert.equal(form.get('metadata[matter]'), '2026-014');
  assert.equal(form.get('address_placement'), null, 'omitted when an extra service supplies the cover sheet');

  const file = form.get('file');
  assert.equal(file.name, 'letter.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.ok(file.size > 0);
});

test('address_placement is sent for plain letters', async () => {
  let form;
  const client = new LobClient({
    apiKey: 'test_key',
    fetchImpl: async (_url, options) => {
      form = options.body;
      return jsonResponse(200, { id: 'ltr_2' });
    },
  });

  await client.createLetter({ ...LETTER, extraService: null, addressPlacement: 'insert_blank_page' });
  assert.equal(form.get('address_placement'), 'insert_blank_page');
  assert.equal(form.get('extra_service'), null);
});

test('the Lob-Version header is sent when configured', async () => {
  let headers;
  const client = new LobClient({
    apiKey: 'test_key',
    apiVersion: '2024-01-01',
    fetchImpl: async (_url, options) => {
      headers = options.headers;
      return jsonResponse(200, {});
    },
  });
  await client.getLetter('ltr_1');
  assert.equal(headers['Lob-Version'], '2024-01-01');
});

test('a 4xx from Lob keeps its status and message', async () => {
  const client = new LobClient({
    apiKey: 'test_key',
    fetchImpl: async () =>
      jsonResponse(422, { error: { message: 'to.address_zip is not a valid zip', code: 'invalid' } }),
  });

  await assert.rejects(
    () => client.createLetter(LETTER),
    (error) => {
      assert.ok(error instanceof LobError);
      assert.equal(error.statusCode, 422);
      assert.equal(error.message, 'to.address_zip is not a valid zip');
      assert.equal(error.lobCode, 'invalid');
      return true;
    },
  );
});

test('a rejected Lob key is reported as a server problem, not a client auth failure', async () => {
  let attempts = 0;
  const client = new LobClient({
    apiKey: 'live_wrong',
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse(401, { error: { message: 'Your API key is not valid', code: 'unauthorized' } });
    },
  });

  await assert.rejects(
    () => client.createLetter(LETTER),
    (error) => {
      // 502, not 401: the add-in must not read this as "your access token was
      // rejected" and re-prompt for the wrong credential.
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /Lob rejected the mail service's API key/);
      assert.match(error.message, /Your API key is not valid/, 'Lob’s own words are kept');
      assert.match(error.message, /LOB_API_KEY/);
      return true;
    },
  );
  assert.equal(attempts, 1, 'a bad key is never worth retrying');
});

test('a 403 from Lob is treated the same way', async () => {
  const client = new LobClient({
    apiKey: 'test_key',
    fetchImpl: async () => jsonResponse(403, { error: { message: 'forbidden' } }),
  });
  await assert.rejects(() => client.getLetter('ltr_1'), (error) => {
    assert.equal(error.statusCode, 502);
    return true;
  });
});

test('server errors are retried, then reported', async () => {
  let attempts = 0;
  const client = new LobClient({
    apiKey: 'test_key',
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? jsonResponse(503, { error: { message: 'try later' } }) : jsonResponse(200, { id: 'ltr_3' });
    },
  });

  const letter = await client.createLetter(LETTER);
  assert.equal(attempts, 3);
  assert.equal(letter.id, 'ltr_3');
});

test('a missing API key fails before any network call', async () => {
  const client = new LobClient({ apiKey: '', fetchImpl: async () => jsonResponse(200, {}) });
  await assert.rejects(() => client.getLetter('ltr_1'), /Lob API key is not configured/);
});

test('summarizeLetter exposes only the fields the task pane shows', () => {
  const summary = summarizeLetter({
    id: 'ltr_9',
    url: 'https://lob.test/9.pdf',
    tracking_number: '9407123',
    expected_delivery_date: '2026-09-01',
    carrier: 'USPS',
    to: { name: 'Jane Doe', address_city: 'Chicago' },
    secret_internal_field: 'nope',
  });
  assert.equal(summary.trackingNumber, '9407123');
  assert.equal(summary.expectedDeliveryDate, '2026-09-01');
  assert.equal(summary.to.name, 'Jane Doe');
  assert.equal(summary.secret_internal_field, undefined);
});

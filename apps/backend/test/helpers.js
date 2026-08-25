import { loadConfig } from '../src/config.js';

export const TEST_TOKEN = 'test-token-that-is-long-enough-1234';

export function testConfig(overrides = {}) {
  const config = loadConfig({
    API_TOKEN: TEST_TOKEN,
    LOB_API_KEY: 'test_abc123',
    RETURN_NAME: 'Benjamin J. Rooney',
    RETURN_COMPANY: 'Rooney Law',
    RETURN_ADDRESS_LINE1: '123 North LaSalle Street',
    RETURN_ADDRESS_LINE2: 'Suite 1200',
    RETURN_ADDRESS_CITY: 'Chicago',
    RETURN_ADDRESS_STATE: 'IL',
    RETURN_ADDRESS_ZIP: '60602',
    ...overrides.env,
  });
  return { ...config, ...overrides.config };
}

/** A tiny but structurally valid PDF. */
export function samplePdf(pages = 1) {
  const pageObjects = Array.from(
    { length: pages },
    (_, index) => `${index + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`,
  ).join('');
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
      `2 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n${pageObjects}%%EOF\n`,
    'latin1',
  );
}

/** Stand-in for LobClient that records what it was asked to send. */
export class FakeLob {
  constructor({ isLive = false, respond } = {}) {
    this.isLive = isLive;
    this.calls = [];
    this.respond = respond ?? ((letter, index) => ({
      id: `ltr_${index}`,
      url: `https://lob.test/${index}.pdf`,
      carrier: 'USPS',
      mail_type: letter.mailType,
      extra_service: letter.extraService,
      tracking_number: letter.extraService ? `9407${index}` : null,
      expected_delivery_date: '2026-09-01',
      to: letter.to,
    }));
  }

  async createLetter(letter) {
    this.calls.push(letter);
    return this.respond(letter, this.calls.length - 1);
  }

  async getLetter(id) {
    return { id, status: 'processed', to: { name: 'Jane Doe' } };
  }
}

/** Start an app on an ephemeral port and return helpers bound to it. */
export async function startServer(app) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
    async post(path, { body, token = TEST_TOKEN, headers = {} } = {}) {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        body,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    async get(path, { token = TEST_TOKEN } = {}) {
      const response = await fetch(`${base}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
  };
}

/** Build the multipart body the add-in sends. */
export function letterForm(payload, { pdf = samplePdf(), filename = 'letter.pdf', contentType = 'application/pdf' } = {}) {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append('file', new Blob([pdf], { type: contentType }), filename);
  return form;
}

export const VALID_PAYLOAD = {
  to: {
    name: 'Jane Doe, Esq.',
    company: 'Doe & Associates LLC',
    address_line1: '500 West Madison Street',
    address_line2: 'Suite 1000',
    address_city: 'Chicago',
    address_state: 'IL',
    address_zip: '60661',
  },
  mailClass: 'regular',
};

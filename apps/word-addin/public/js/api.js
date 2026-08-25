/**
 * Client for the firm's mail service. The Lob key lives on that service, never
 * here — this module only ever sees the shared access token.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, details = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 300) } };
  }
}

export class ApiClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
    this.token = token ?? '';
  }

  async request(path, { method = 'GET', body, headers = {} } = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        body,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...headers },
      });
    } catch (cause) {
      throw new ApiError(
        `Could not reach the mail service at ${this.baseUrl}. Check the service address and your internet connection.`,
        { status: 0 },
      );
    }

    const payload = await readBody(response);
    if (!response.ok) {
      const message = payload?.error?.message ?? `The mail service returned ${response.status}.`;
      throw new ApiError(message, { status: response.status, details: payload?.error?.details ?? [] });
    }
    return payload ?? {};
  }

  /** Server-side defaults: return address, print options, available mail classes. */
  getConfig() {
    return this.request('/api/config');
  }

  /**
   * Upload the PDF and mail it.
   *
   * @param {object} options
   * @param {Blob} options.pdf
   * @param {string} options.filename
   * @param {object} options.payload recipient, CCs, mail class, print options
   * @returns {Promise<{ok: boolean, mode: string, pages: number|null, mailings: object[]}>}
   */
  async createLetters({ pdf, filename, payload }) {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append('file', pdf, filename);
    return this.request('/api/letters', { method: 'POST', body: form });
  }

  getLetter(id) {
    return this.request(`/api/letters/${encodeURIComponent(id)}`);
  }

  /** Pull a letter back out of production, if Lob's window is still open. */
  cancelLetter(id) {
    return this.request(`/api/letters/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }

  /** Check one address against USPS data without creating a letter. */
  verifyAddress(address) {
    return this.request('/api/addresses/verify', {
      method: 'POST',
      body: JSON.stringify({ address }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Recent letters with their latest tracking event. */
  getMailings(limit = 10) {
    return this.request(`/api/mailings?limit=${encodeURIComponent(limit)}`);
  }
}

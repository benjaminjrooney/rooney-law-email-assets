/**
 * Minimal Lob Print & Mail client.
 *
 * Only the letter endpoints are wrapped, using multipart uploads so the PDF
 * exported by Word can be streamed straight through without ever hitting disk.
 * https://docs.lob.com/#tag/Letters
 */

export class LobError extends Error {
  constructor(message, { statusCode = 502, lobCode = null, requestId = null } = {}) {
    super(message);
    this.name = 'LobError';
    this.statusCode = statusCode;
    this.lobCode = lobCode;
    this.requestId = requestId;
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Flatten `{to: {name: 'x'}}` into the `to[name]=x` form Lob expects. */
function appendAddress(form, field, address) {
  for (const [key, value] of Object.entries(address)) {
    if (value === null || value === undefined || value === '') continue;
    form.append(`${field}[${key}]`, String(value));
  }
}

export class LobClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey Lob secret key (`test_...` or `live_...`).
   * @param {string} [options.baseUrl]
   * @param {string} [options.apiVersion] value for the `Lob-Version` header.
   * @param {number} [options.timeoutMs]
   * @param {typeof fetch} [options.fetchImpl] injected in tests.
   */
  constructor({ apiKey, baseUrl = 'https://api.lob.com/v1', apiVersion = '', timeoutMs = 60_000, fetchImpl } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiVersion = apiVersion;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  get isLive() {
    return this.apiKey.startsWith('live_');
  }

  headers(extra = {}) {
    const auth = Buffer.from(`${this.apiKey}:`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json', ...extra };
    if (this.apiVersion) headers['Lob-Version'] = this.apiVersion;
    return headers;
  }

  async request(path, { method = 'GET', body, headers, retries = 2 } = {}) {
    if (!this.apiKey) {
      throw new LobError('Lob API key is not configured on the server.', { statusCode: 503 });
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          body,
          headers: this.headers(headers),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        lastError = new LobError(`Could not reach Lob: ${cause.message}`, { statusCode: 504 });
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw lastError;
      }

      const requestId = response.headers.get('x-lob-request-id');
      const raw = await response.text();
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }

      if (response.ok) return parsed ?? {};

      const lobMessage = parsed?.error?.message ?? raw.slice(0, 500) ?? 'Unknown Lob error';
      const lobCode = parsed?.error?.code ?? null;

      // A 401/403 here means *Lob* rejected this server's API key, which has
      // nothing to do with the add-in's own token. Passing the status straight
      // through would make the task pane blame the user's access token and
      // re-prompt for it, sending them after the wrong credential.
      if (response.status === 401 || response.status === 403) {
        throw new LobError(
          `Lob rejected the mail service's API key (Lob said: ${lobMessage}). Check LOB_API_KEY on the server.`,
          { statusCode: 502, lobCode, requestId },
        );
      }

      if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
        lastError = new LobError(lobMessage, { statusCode: response.status, lobCode, requestId });
        await sleep(500 * 2 ** attempt);
        continue;
      }

      // 4xx from Lob is nearly always a bad address or an unusable PDF: pass the
      // status through so the task pane can show it as a user error, not a crash.
      const statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      throw new LobError(lobMessage, { statusCode, lobCode, requestId });
    }

    throw lastError ?? new LobError('Lob request failed.', { statusCode: 502 });
  }

  /**
   * Create and mail one letter.
   *
   * @param {object} letter
   * @param {object} letter.to normalized Lob address object
   * @param {object} letter.from normalized Lob address object
   * @param {{buffer: Buffer, filename: string}} letter.file the PDF to mail
   * @param {string} letter.mailType `usps_first_class` or `usps_standard`
   * @param {string|null} letter.extraService `certified`, `certified_return_receipt`, `registered`, or null
   * @param {boolean} letter.color
   * @param {boolean} letter.doubleSided
   * @param {string|null} letter.addressPlacement omitted when an extra service supplies its own cover sheet
   * @param {string} [letter.description]
   * @param {string} [letter.useType] `operational` for legal correspondence
   * @param {object} [letter.metadata]
   * @param {string} [letter.idempotencyKey] makes retries safe — Lob replays the original response
   */
  async createLetter({
    to,
    from,
    file,
    mailType,
    extraService,
    color,
    doubleSided,
    addressPlacement,
    description,
    useType,
    metadata = {},
    idempotencyKey,
  }) {
    const form = new FormData();
    appendAddress(form, 'to', to);
    appendAddress(form, 'from', from);
    form.append('file', new Blob([file.buffer], { type: 'application/pdf' }), file.filename);
    form.append('color', String(Boolean(color)));
    form.append('double_sided', String(Boolean(doubleSided)));
    if (mailType) form.append('mail_type', mailType);
    if (extraService) form.append('extra_service', extraService);
    if (addressPlacement) form.append('address_placement', addressPlacement);
    if (description) form.append('description', description);
    if (useType) form.append('use_type', useType);
    for (const [key, value] of Object.entries(metadata)) {
      form.append(`metadata[${key}]`, String(value));
    }

    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    return this.request('/letters', { method: 'POST', body: form, headers });
  }

  async getLetter(id) {
    return this.request(`/letters/${encodeURIComponent(id)}`);
  }

  /**
   * Pull a letter out of production. Only possible while the letter's
   * `send_date` is still in the future — five minutes after creation on a
   * default Lob account. Never retried: a cancel that timed out may well have
   * landed, and asking twice turns a success into a confusing 404.
   */
  async cancelLetter(id) {
    return this.request(`/letters/${encodeURIComponent(id)}`, { method: 'DELETE', retries: 0 });
  }

  async listLetters({ limit = 10 } = {}) {
    const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
    return this.request(`/letters?${params}`);
  }

  /**
   * Check an address against USPS data before spending postage on it.
   *
   * Note: Lob only returns real results for a *live* API key. With a test key
   * the request is validated but comes back empty, so callers must tell the
   * user rather than presenting an empty result as "undeliverable".
   */
  async verifyUsAddress(address) {
    const body = {
      recipient: address.name || address.company || undefined,
      primary_line: address.address_line1,
      secondary_line: address.address_line2 || undefined,
      city: address.address_city,
      state: address.address_state,
      zip_code: address.address_zip,
    };
    for (const key of Object.keys(body)) {
      if (body[key] === undefined || body[key] === '') delete body[key];
    }
    // `case=proper` keeps the standardized address in mixed case, so it can be
    // dropped straight back into the form without shouting at the recipient.
    return this.request('/us_verifications?case=proper', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Turn a Lob us_verification into something the task pane can act on.
 *
 * @param {object} verification raw Lob response
 * @param {boolean} testMode true when the service runs on a test Lob key
 */
export function summarizeVerification(verification, { testMode = false } = {}) {
  const components = verification?.components ?? {};
  const zip = components.zip_code ?? '';
  const plus4 = components.zip_code_plus_4 ?? '';

  const standardized = {
    address_line1: verification?.primary_line ?? '',
    address_line2: verification?.secondary_line ?? '',
    address_city: components.city ?? '',
    address_state: components.state ?? '',
    address_zip: zip && plus4 ? `${zip}-${plus4}` : zip,
  };

  const deliverability = verification?.deliverability ?? null;
  // Lob returns an empty object for a test key, which must not read as "bad address".
  const usable = Boolean(deliverability) && Boolean(standardized.address_line1);

  return {
    deliverability,
    validAddress: verification?.valid_address ?? null,
    confidenceScore: verification?.lob_confidence_score?.score ?? null,
    standardized: usable ? standardized : null,
    usable,
    testModeLimited: testMode && !usable,
    message: describeDeliverability(deliverability, { testMode, usable }),
  };
}

const DELIVERABILITY_MESSAGES = {
  deliverable: 'USPS can deliver to this address.',
  deliverable_unnecessary_unit: 'Deliverable. The suite/unit line is not needed and can be dropped.',
  deliverable_incorrect_unit:
    'Deliverable to the building, but the suite/unit may not exist — the letter may not reach the addressee.',
  deliverable_missing_unit:
    'Deliverable to the building, but a suite/unit is missing — the letter may not reach the addressee.',
  undeliverable: 'USPS does not recognize this address. Check it before sending.',
};

function describeDeliverability(deliverability, { testMode, usable }) {
  if (!usable) {
    return testMode
      ? 'Address checking needs a live Lob key. On a test key Lob returns an empty result, so nothing can be confirmed here.'
      : 'Lob returned no verification result for this address.';
  }
  return DELIVERABILITY_MESSAGES[deliverability] ?? `Lob reported "${deliverability}".`;
}

/** Reduce a Lob letter object to the fields the add-in displays. */
export function summarizeLetter(letter) {
  return {
    id: letter?.id ?? null,
    url: letter?.url ?? null,
    carrier: letter?.carrier ?? null,
    mailType: letter?.mail_type ?? null,
    extraService: letter?.extra_service ?? null,
    trackingNumber: letter?.tracking_number ?? null,
    expectedDeliveryDate: letter?.expected_delivery_date ?? null,
    sendDate: letter?.send_date ?? null,
    dateCreated: letter?.date_created ?? null,
    to: letter?.to
      ? {
          name: letter.to.name ?? null,
          company: letter.to.company ?? null,
          address_line1: letter.to.address_line1 ?? null,
          address_line2: letter.to.address_line2 ?? null,
          address_city: letter.to.address_city ?? null,
          address_state: letter.to.address_state ?? null,
          address_zip: letter.to.address_zip ?? null,
        }
      : null,
  };
}

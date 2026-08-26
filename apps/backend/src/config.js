/**
 * Environment-driven configuration.
 *
 * Everything the firm might want to change between environments lives here so
 * that no address, key, or default is hard-coded anywhere else in the service.
 */

import { loadRates } from './pricing.js';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function bool(name, fallback, env) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new Error(`Invalid boolean for ${name}: ${raw}`);
}

function int(name, fallback, env) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return parsed;
}

function str(name, fallback, env) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const trimmed = String(raw).trim();
  return trimmed === '' ? fallback : trimmed;
}

const ADDRESS_PLACEMENTS = new Set([
  'top_first_page',
  'insert_blank_page',
  'bottom_first_page',
  'bottom_first_page_center',
]);

export function loadConfig(env = process.env) {
  const apiToken = str('API_TOKEN', '', env);
  const lobApiKey = str('LOB_API_KEY', '', env);

  const addressPlacement = str('DEFAULT_ADDRESS_PLACEMENT', 'insert_blank_page', env);
  if (!ADDRESS_PLACEMENTS.has(addressPlacement)) {
    throw new Error(
      `Invalid DEFAULT_ADDRESS_PLACEMENT: ${addressPlacement}. ` +
        `Expected one of ${[...ADDRESS_PLACEMENTS].join(', ')}`,
    );
  }

  return {
    port: int('PORT', 3000, env),
    nodeEnv: str('NODE_ENV', 'development', env),

    // Shared secret the Word add-in presents as `Authorization: Bearer <token>`.
    apiToken,

    lob: {
      apiKey: lobApiKey,
      baseUrl: str('LOB_BASE_URL', 'https://api.lob.com/v1', env),
      // Lob pins breaking changes behind a dated version header.
      apiVersion: str('LOB_API_VERSION', '', env),
      // "operational" is correct for legal correspondence; marketing mail is a
      // different USPS use type and Lob requires the distinction.
      useType: str('LOB_USE_TYPE', 'operational', env),
      timeoutMs: int('LOB_TIMEOUT_MS', 60_000, env),
      // Shown on the webhook's page in the Lob dashboard. Without it the
      // webhook endpoint refuses every delivery.
      webhookSecret: str('LOB_WEBHOOK_SECRET', '', env),
      // Fallback only: the real window comes from each letter's send_date.
      cancellationWindowMinutes: int('LOB_CANCELLATION_WINDOW_MINUTES', 5, env),
    },

    // Address checking costs a Lob lookup per call and only returns real
    // results on a live key, so it is opt-in rather than automatic.
    verifyBeforeSend: bool('VERIFY_BEFORE_SEND', false, env),

    // Postage rates for the cost estimate. Unset means no estimate is shown.
    rates: loadRates(env),

    events: {
      // Append tracking events here as JSON lines, e.g. a Railway volume at
      // /data/lob-events.jsonl. Unset means memory only.
      logPath: str('EVENT_LOG_PATH', '', env),
      maxEvents: int('EVENT_MAX_RETAINED', 500, env),
    },

    // The firm's return address, printed on the envelope.
    returnAddress: {
      name: str('RETURN_NAME', '', env),
      company: str('RETURN_COMPANY', '', env),
      address_line1: str('RETURN_ADDRESS_LINE1', '', env),
      address_line2: str('RETURN_ADDRESS_LINE2', '', env),
      address_city: str('RETURN_ADDRESS_CITY', '', env),
      address_state: str('RETURN_ADDRESS_STATE', '', env),
      address_zip: str('RETURN_ADDRESS_ZIP', '', env),
      address_country: 'US',
    },

    defaults: {
      color: bool('DEFAULT_COLOR', false, env),
      doubleSided: bool('DEFAULT_DOUBLE_SIDED', false, env),
      addressPlacement,
    },

    limits: {
      maxFileBytes: int('MAX_FILE_BYTES', 25 * 1024 * 1024, env),
      maxPerHour: int('MAX_LETTERS_PER_HOUR', 40, env),
      maxPerDay: int('MAX_LETTERS_PER_DAY', 120, env),
    },

    // Only needed if the task pane is hosted somewhere other than this service.
    allowedOrigins: str('ALLOWED_ORIGINS', '', env)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),

    serveAddin: bool('SERVE_ADDIN', true, env),
  };
}

/**
 * Problems that should stop the service from booting, vs. problems we only
 * surface on /healthz so a misconfigured deploy still serves a useful error.
 */
export function configProblems(config) {
  const problems = [];
  if (!config.apiToken) {
    problems.push('API_TOKEN is not set — every request will be rejected.');
  } else if (config.apiToken.length < 24) {
    problems.push('API_TOKEN is shorter than 24 characters; use a longer random secret.');
  }
  if (!config.lob.apiKey) {
    problems.push('LOB_API_KEY is not set — letters cannot be created.');
  }
  const ret = config.returnAddress;
  if (!ret.name && !ret.company) {
    problems.push('RETURN_NAME or RETURN_COMPANY must be set.');
  }
  for (const [field, envName] of [
    ['address_line1', 'RETURN_ADDRESS_LINE1'],
    ['address_city', 'RETURN_ADDRESS_CITY'],
    ['address_state', 'RETURN_ADDRESS_STATE'],
    ['address_zip', 'RETURN_ADDRESS_ZIP'],
  ]) {
    if (!ret[field]) problems.push(`${envName} is not set.`);
  }
  return problems;
}

export function isLiveLobKey(apiKey) {
  return apiKey.startsWith('live_');
}

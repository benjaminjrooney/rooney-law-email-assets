/**
 * Request validation for the /api/letters endpoint.
 *
 * Hand-rolled rather than schema-library driven so the error messages read the
 * way the task pane wants to display them: one message per field, in plain
 * English, pointing at the field the user has to fix.
 */

/**
 * The mail classes the add-in offers, mapped onto the Lob parameters that
 * actually produce them. `usps_standard` is deliberately not offered: it is
 * marketing-class mail and inappropriate for legal correspondence.
 */
export const MAIL_CLASSES = {
  regular: {
    id: 'regular',
    label: 'Regular mail (First-Class)',
    mailType: 'usps_first_class',
    extraService: null,
    tracked: false,
  },
  certified: {
    id: 'certified',
    label: 'Certified mail',
    mailType: 'usps_first_class',
    extraService: 'certified',
    tracked: true,
  },
  certified_return_receipt: {
    id: 'certified_return_receipt',
    label: 'Certified mail, return receipt requested',
    mailType: 'usps_first_class',
    extraService: 'certified_return_receipt',
    tracked: true,
  },
  registered: {
    id: 'registered',
    label: 'Registered mail',
    mailType: 'usps_first_class',
    extraService: 'registered',
    tracked: true,
  },
};

export const ADDRESS_PLACEMENTS = [
  'top_first_page',
  'insert_blank_page',
  'bottom_first_page',
  'bottom_first_page_center',
];

const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

const ADDRESS_FIELDS = [
  'name',
  'company',
  'address_line1',
  'address_line2',
  'address_city',
  'address_state',
  'address_zip',
];

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Strip an incoming address down to the fields Lob accepts. */
export function normalizeAddress(input) {
  const address = {};
  for (const field of ADDRESS_FIELDS) {
    const value = text(input?.[field]);
    if (value) address[field] = value;
  }
  if (address.address_state) address.address_state = address.address_state.toUpperCase();
  address.address_country = 'US';
  return address;
}

/**
 * @returns {string[]} human-readable problems, empty when the address is usable.
 */
export function validateAddress(address, label) {
  const errors = [];
  const prefix = label ? `${label}: ` : '';

  if (!address.name && !address.company) {
    errors.push(`${prefix}a recipient name or company is required.`);
  }
  if (address.name && address.name.length > 40) {
    errors.push(`${prefix}name must be 40 characters or fewer (Lob limit).`);
  }
  if (address.company && address.company.length > 40) {
    errors.push(`${prefix}company must be 40 characters or fewer (Lob limit).`);
  }
  if (!address.address_line1) {
    errors.push(`${prefix}street address is required.`);
  }
  if (!address.address_city) {
    errors.push(`${prefix}city is required.`);
  }
  if (!address.address_state) {
    errors.push(`${prefix}state is required.`);
  } else if (!STATE_RE.test(address.address_state)) {
    errors.push(`${prefix}state must be a two-letter abbreviation (got "${address.address_state}").`);
  }
  if (!address.address_zip) {
    errors.push(`${prefix}ZIP code is required.`);
  } else if (!ZIP_RE.test(address.address_zip)) {
    errors.push(`${prefix}ZIP code must look like 60601 or 60601-1234 (got "${address.address_zip}").`);
  }
  return errors;
}

function normalizeMetadata(input, errors) {
  const metadata = {};
  if (input === null || input === undefined) return metadata;
  if (typeof input !== 'object' || Array.isArray(input)) {
    errors.push('metadata must be an object of string values.');
    return metadata;
  }
  const entries = Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (entries.length > 20) {
    errors.push('metadata supports at most 20 keys (Lob limit).');
  }
  for (const [key, value] of entries.slice(0, 20)) {
    if (key.length > 40) {
      errors.push(`metadata key "${key}" is longer than 40 characters (Lob limit).`);
      continue;
    }
    metadata[key] = String(value).slice(0, 500);
  }
  return metadata;
}

/**
 * Validate the JSON payload that accompanies the uploaded PDF.
 *
 * @param {unknown} payload parsed request body
 * @param {object} config service config, used for defaults
 * @returns {{errors: string[], value?: object}}
 */
export function validateLetterRequest(payload, config) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { errors: ['Request payload must be a JSON object.'] };
  }

  const mailClassId = text(payload.mailClass) || 'regular';
  const mailClass = MAIL_CLASSES[mailClassId];
  if (!mailClass) {
    errors.push(
      `Unknown mail class "${mailClassId}". Expected one of ${Object.keys(MAIL_CLASSES).join(', ')}.`,
    );
  }

  const to = normalizeAddress(payload.to);
  errors.push(...validateAddress(to, 'Recipient'));

  // The return address defaults to the firm's configured address; the add-in
  // may override it (e.g. a different office).
  const fromInput = payload.from && Object.keys(payload.from).length > 0 ? payload.from : config.returnAddress;
  const from = normalizeAddress(fromInput);
  errors.push(...validateAddress(from, 'Return address'));

  // Each CC recipient becomes its own physical letter with the same PDF.
  const ccInput = Array.isArray(payload.cc) ? payload.cc : [];
  if (ccInput.length > 10) {
    errors.push('At most 10 CC recipients can be mailed in one request.');
  }
  const cc = [];
  ccInput.slice(0, 10).forEach((entry, index) => {
    const address = normalizeAddress(entry);
    const label = `CC recipient ${index + 1}`;
    errors.push(...validateAddress(address, label));
    const ccClassId = text(entry?.mailClass) || mailClassId;
    const ccClass = MAIL_CLASSES[ccClassId];
    if (!ccClass) {
      errors.push(`${label}: unknown mail class "${ccClassId}".`);
      return;
    }
    cc.push({ address, mailClass: ccClass });
  });

  const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
  const color = options.color === undefined ? config.defaults.color : Boolean(options.color);
  const doubleSided =
    options.doubleSided === undefined ? config.defaults.doubleSided : Boolean(options.doubleSided);

  let addressPlacement = text(options.addressPlacement) || config.defaults.addressPlacement;
  if (!ADDRESS_PLACEMENTS.includes(addressPlacement)) {
    errors.push(
      `Unknown addressPlacement "${addressPlacement}". Expected one of ${ADDRESS_PLACEMENTS.join(', ')}.`,
    );
    addressPlacement = config.defaults.addressPlacement;
  }

  const description = text(options.description).slice(0, 255);
  const metadata = normalizeMetadata(payload.metadata, errors);

  const idempotencyKey = text(payload.idempotencyKey);
  if (idempotencyKey && idempotencyKey.length > 256) {
    errors.push('idempotencyKey must be 256 characters or fewer.');
  }

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    value: {
      to,
      from,
      cc,
      mailClass,
      options: { color, doubleSided, addressPlacement, description },
      metadata,
      idempotencyKey,
    },
  };
}

/** Cheap sanity check that the upload really is a PDF. */
export function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Count pages without a PDF library: every page object carries a `/Type /Page`
 * marker. Used only to warn about Lob's page limits, so an approximate answer
 * that never throws is better than a hard dependency.
 *
 * @returns {number|null} null when the file is compressed in a way we cannot read.
 */
export function estimatePageCount(buffer) {
  if (!looksLikePdf(buffer)) return null;
  const content = buffer.toString('latin1');
  const matches = content.match(/\/Type\s*\/Page[^s]/g);
  if (matches && matches.length > 0) return matches.length;
  const countMatch = content.match(/\/Count\s+(\d+)/);
  if (countMatch) return Number.parseInt(countMatch[1], 10);
  return null;
}

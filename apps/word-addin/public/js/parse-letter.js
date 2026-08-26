/**
 * Letter auto-extraction.
 *
 * Rooney Law letters follow a fixed shape:
 *
 *   VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED   <- delivery method, very top
 *
 *   Jane Doe, Esq.                                 <- recipient, right below
 *   Doe & Associates LLC
 *   500 West Madison Street, Suite 1000
 *   Chicago, Illinois 60661
 *
 *   Re: Smith v. Jones                             <- optional subject
 *   ...
 *   cc:  Robert Roe (via regular mail)             <- CC block, near the bottom
 *        Roe Law Group
 *        1 N Wacker Dr
 *        Chicago, IL 60606
 *
 * This module turns that text into pre-filled form values. Everything it
 * returns is a suggestion the user confirms in the task pane, so the parser
 * favours "no answer" over a confident wrong answer, and always falls back to
 * regular mail when it cannot tell.
 *
 * Pure ES module with no DOM or Office dependency so it can be unit tested
 * under plain Node.
 */

/** Mail classes the backend understands, in priority order for detection. */
export const DELIVERY_PATTERNS = [
  {
    mailClass: 'certified_return_receipt',
    patterns: [
      /certified\s+mail[^.\n]*return\s+receipt/i,
      /return\s+receipt\s+requested/i,
      /certified\s+mail[^.\n]*\brrr\b/i,
    ],
  },
  { mailClass: 'certified', patterns: [/certified\s+mail/i, /\bcertified\b(?!\s+copy)/i] },
  { mailClass: 'registered', patterns: [/registered\s+mail/i] },
  {
    mailClass: 'regular',
    patterns: [
      /first[\s-]?class\s+mail/i,
      /u\.?\s?s\.?\s+mail/i,
      /regular\s+mail/i,
      /ordinary\s+mail/i,
      /united\s+states\s+mail/i,
      /\busps\b/i,
    ],
  },
];

/** Delivery methods that do not produce a physical Lob mailing. */
export const NON_MAIL_PATTERNS = [
  { method: 'email', pattern: /\b(e-?mail|electronic\s+mail)\b/i },
  { method: 'fax', pattern: /\b(facsimile|fax)\b/i },
  { method: 'hand', pattern: /\b(hand[\s-]?deliver(y|ed)?|personal\s+(service|delivery)|messenger)\b/i },
  { method: 'overnight', pattern: /\b(overnight|federal\s+express|fedex|ups\s+next\s+day|priority\s+overnight)\b/i },
  { method: 'efiling', pattern: /\b(e-?fil(e|ing)|electronic\s+filing)\b/i },
];

const STATE_ABBREVIATIONS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA',
  'VI', 'WA', 'WV', 'WI', 'WY',
]);

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};

const ORGANIZATION_HINT =
  /\b(llc|l\.l\.c\.|inc|inc\.|corp|corp\.|corporation|company|co\.|ltd|ltd\.|l\.p\.|lp|llp|l\.l\.p\.|p\.c\.|pc|associates|partners|group|law\s+offices?|firm|bank|trust|insurance|properties|management|holdings|university|department|district|city\s+of|county\s+of|state\s+of)\b/i;

const PERSON_SUFFIX = /\b(esq\.?|jr\.?|sr\.?|ii|iii|iv|m\.?d\.?|ph\.?d\.?|cpa)\b/i;

const STREET_HINT =
  /\b(street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|circle|cir\.?|place|pl\.?|plaza|parkway|pkwy\.?|highway|hwy\.?|route|rte\.?|terrace|trail|way|square|sq\.?)\b/i;

const SECONDARY_UNIT =
  /^(suite|ste\.?|apt\.?|apartment|unit|floor|fl\.?|room|rm\.?|building|bldg\.?|#|no\.?)\b/i;

const PO_BOX = /\b(p\.?\s?o\.?\s+box|post\s+office\s+box|box\s+\d+)\b/i;

const ATTENTION = /^(attention|attn\.?|att\.?|c\/o|care\s+of)\s*[::]?\s*/i;

const CC_LINE = /^\s*(cc|c\.c\.|ccs|copy\s+to|copies\s+to)\s*[::]?\s*(.*)$/i;

const END_OF_CC =
  /^\s*(enclosures?|encl\.?|attachments?|bcc\b|via\s+e-?mail\s+only\b|\d+\s*$)/i;

const DATE_LINE =
  /^\s*((january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*$/i;

const SUBJECT_LINE = /^\s*(re|subject)\s*[::]\s*(.+)$/i;

const SALUTATION = /^\s*(dear|to\s+whom\s+it\s+may\s+concern)\b/i;

const CITY_STATE_ZIP = /^(.+?)[,\s]+([A-Za-z][A-Za-z.\s]*?)[,\s]+(\d{5})(?:-(\d{4}))?\.?$/;

const EMAIL_LINE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

const LABELLED_PHONE =
  /^(direct|tel|telephone|phone|fax|facsimile|mobile|cell|main|office)\b[\s.:]*[\d().+\-\s]{7,}$/i;

const BARE_PHONE = /^[\d().+\-\s]{10,}$/;

/** Split raw document text into trimmed lines. Word uses \r between paragraphs. */
export function toLines(text) {
  return String(text ?? '')
    .replace(/\u000B/g, '\n') // Word line breaks (Shift+Enter)
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim());
}

function normalizeState(raw) {
  const cleaned = String(raw ?? '').replace(/\./g, '').trim();
  if (cleaned.length === 2 && STATE_ABBREVIATIONS.has(cleaned.toUpperCase())) {
    return cleaned.toUpperCase();
  }
  const named = STATE_NAMES[cleaned.toLowerCase()];
  return named ?? null;
}

/** Parse "Chicago, Illinois 60661" / "Chicago, IL 60661-1234". */
export function parseCityStateZip(line) {
  const match = String(line ?? '').trim().match(CITY_STATE_ZIP);
  if (!match) return null;
  const state = normalizeState(match[2]);
  if (!state) return null;
  const city = match[1].replace(/[,\s]+$/, '').trim();
  if (!city || /\d/.test(city.replace(/\d+(st|nd|rd|th)\b/gi, ''))) {
    // "1234 Main St 60601" is a street line, not a city line.
    if (/^\d/.test(city)) return null;
  }
  return {
    address_city: city,
    address_state: state,
    address_zip: match[4] ? `${match[3]}-${match[4]}` : match[3],
  };
}

function looksLikeStreet(line) {
  if (!line) return false;
  if (PO_BOX.test(line)) return true;
  if (SECONDARY_UNIT.test(line)) return true;
  if (/^\d+[\w-]*\s+\S/.test(line)) return true; // "500 W Madison Street"
  return STREET_HINT.test(line);
}

/**
 * Detect the delivery method named on a line.
 *
 * @returns {{mailClass: string|null, otherMethods: string[]}}
 */
export function detectDeliveryMethod(line) {
  const text = String(line ?? '');
  let mailClass = null;
  for (const entry of DELIVERY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      mailClass = entry.mailClass;
      break;
    }
  }
  const otherMethods = NON_MAIL_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ method }) => method,
  );
  return { mailClass, otherMethods };
}

function isDeliveryHeader(line) {
  if (!line) return false;
  const { mailClass, otherMethods } = detectDeliveryMethod(line);
  if (!mailClass && otherMethods.length === 0) return false;
  // "VIA ..." or an all-caps line; body prose mentioning certified mail should
  // not be mistaken for the header.
  if (/^via\b/i.test(line)) return true;
  if (/^(by|sent\s+via|delivered\s+via)\b/i.test(line)) return true;
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase() && line.length <= 90;
}

/**
 * Turn a contiguous block of address lines into Lob address fields.
 *
 * @param {string[]} block
 * @returns {object|null}
 */
export function parseAddressBlock(block) {
  const lines = block.map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  let cityIndex = -1;
  let cityParts = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseCityStateZip(lines[i]);
    if (parsed) {
      cityIndex = i;
      cityParts = parsed;
      break;
    }
  }
  if (!cityParts) return null;

  const above = lines.slice(0, cityIndex);
  const streetLines = [];
  let index = above.length - 1;
  while (index >= 0 && streetLines.length < 2 && looksLikeStreet(above[index])) {
    streetLines.unshift(above[index]);
    index -= 1;
  }
  if (streetLines.length === 0 && above.length > 0) {
    // No recognizable street keyword — assume the line above the city is it.
    streetLines.unshift(above[above.length - 1]);
    index = above.length - 2;
  }

  const nameLines = above.slice(0, index + 1);
  const address = { ...cityParts };

  // A trailing "Suite 1000" line becomes address_line2; two street-ish lines
  // keep their order.
  address.address_line1 = streetLines[0] ?? '';
  if (streetLines[1]) address.address_line2 = streetLines[1];

  const cleanedNames = [];
  for (const line of nameLines) {
    const stripped = line.replace(ATTENTION, '').trim();
    if (stripped) cleanedNames.push({ text: stripped, wasAttention: ATTENTION.test(line) });
  }

  const isOrganization = (entry) => ORGANIZATION_HINT.test(entry.text) && !PERSON_SUFFIX.test(entry.text);
  let extras = [];

  const attentionIndex = cleanedNames.findIndex((entry) => entry.wasAttention);
  if (attentionIndex >= 0) {
    // "Attn: Claims Department" is always the addressee line, even when it
    // reads like an organization.
    address.name = cleanedNames[attentionIndex].text;
    const others = cleanedNames.filter((_, index) => index !== attentionIndex);
    if (others.length > 0) address.company = others[0].text;
    extras = others.slice(1);
  } else if (cleanedNames.length === 1) {
    const only = cleanedNames[0];
    if (isOrganization(only)) address.company = only.text;
    else address.name = only.text;
  } else if (cleanedNames.length >= 2) {
    const [first, second, ...rest] = cleanedNames;
    if (isOrganization(first) && !isOrganization(second)) {
      address.company = first.text;
      address.name = second.text;
    } else {
      address.name = first.text;
      address.company = second.text;
    }
    extras = rest;
  }

  for (const extra of extras) {
    // Anything further up is usually a second organization line; keep it in
    // address_line2 when that slot is free rather than dropping it.
    if (!address.address_line2) address.address_line2 = extra.text;
  }

  const confidence = streetLines.length > 0 && (address.name || address.company) ? 'high' : 'low';
  return { ...address, address_country: 'US', confidence, rawBlock: lines };
}

/** Parse "Jane Doe, 500 W Madison St, Suite 100, Chicago, IL 60661" on one line. */
export function parseInlineAddress(line) {
  const parts = String(line ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;

  // Rebuild as a block: the last two comma groups are "City" and "ST ZIP".
  const tail = parts.slice(-2).join(', ');
  const cityParts = parseCityStateZip(tail);
  if (!cityParts) return null;

  const head = parts.slice(0, -2);
  if (head.length === 0) return null;

  const streetStart = head.findIndex((part) => looksLikeStreet(part));
  const nameParts = streetStart > 0 ? head.slice(0, streetStart) : head.slice(0, Math.max(head.length - 1, 1));
  const streetParts = streetStart > 0 ? head.slice(streetStart) : head.slice(Math.max(head.length - 1, 1));
  if (streetParts.length === 0) return null;

  return parseAddressBlock([...nameParts, streetParts.join(', '), tail]);
}

function blockToAddress(block) {
  if (block.length === 1) return parseInlineAddress(block[0]) ?? parseAddressBlock(block);
  return parseAddressBlock(block) ?? parseInlineAddress(block.join(', '));
}

/** A line that belongs to a letterhead or signature block, not to an address. */
function isContactLine(line) {
  return EMAIL_LINE.test(line) || LABELLED_PHONE.test(line) || BARE_PHONE.test(line);
}

/** Walking up from a city line, these mark the top of the address block. */
function endsAddressBlock(line) {
  return (
    line === '' ||
    DATE_LINE.test(line) ||
    SUBJECT_LINE.test(line) ||
    SALUTATION.test(line) ||
    CC_LINE.test(line) ||
    isDeliveryHeader(line)
  );
}

/**
 * Collect the address lines sitting directly above a `City, ST ZIP` line.
 *
 * Real letters set their spacing with paragraph styles, not empty paragraphs,
 * so a blank line cannot be relied on to mark where the block begins — the
 * city line is the anchor and everything address-shaped above it belongs to it.
 */
function addressLinesAbove(lines, cityIndex, floor) {
  const collected = [];
  for (let index = cityIndex - 1; index >= floor && collected.length < 6; index -= 1) {
    const line = lines[index];
    if (endsAddressBlock(line)) break;
    // An email or phone line sits inside plenty of address blocks; skip it
    // rather than letting it end the block.
    if (isContactLine(line)) continue;
    // Address lines are short. A long line is body prose, so the block is done.
    if (line.length > 90) break;
    collected.unshift(line);
  }
  return collected;
}

/** Compare street lines ignoring punctuation and spacing ("217 S. Third St." ≡ "217 S Third St"). */
function sameStreet(a, b) {
  const normalize = (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const left = normalize(a);
  return left !== '' && left === normalize(b);
}

/**
 * The firm's own address, from the letterhead or the signature block.
 *
 * Matching on ZIP alone is wrong and was actively harmful: a firm mails to
 * plenty of people in its own town, and every one of them was being discarded
 * as letterhead, leaving the recipient blank with no explanation of why. The
 * street line is the field that actually identifies the firm's own address, and
 * the firm's name catches the letterhead when its street is not configured.
 */
function isOwnAddress(address, options) {
  if (sameStreet(address.address_line1, options.excludeLine1)) return true;

  const company = String(options.excludeCompany ?? '').trim().toLowerCase();
  if (
    company &&
    [address.company, address.name].some((value) => value && value.toLowerCase().includes(company))
  ) {
    return true;
  }
  return false;
}

/**
 * Find the recipient by anchoring on the salutation.
 *
 * In every standard business letter the recipient block sits above "Dear …",
 * and the signature block sits below it. Anchoring there keeps the firm's own
 * address out of range even when the two are only paragraphs apart.
 */
function findRecipient(lines, deliveryIndex, options) {
  const start = deliveryIndex >= 0 ? deliveryIndex + 1 : 0;

  let boundary = lines.findIndex((line, index) => index >= start && SALUTATION.test(line));
  if (boundary < 0) {
    // No salutation: fall back to the subject line, then to a fixed window.
    boundary = lines.findIndex((line, index) => index >= start && SUBJECT_LINE.test(line));
  }
  if (boundary < 0) boundary = Math.min(lines.length, start + 30);

  for (let index = start; index < boundary; index += 1) {
    if (!parseCityStateZip(lines[index])) continue;
    const address = parseAddressBlock([...addressLinesAbove(lines, index, start), lines[index]]);
    if (!address) continue;
    // Skip the letterhead and keep looking for the addressee below it.
    if (isOwnAddress(address, options)) continue;
    return address;
  }
  return null;
}

function findCcSection(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = lines[i].match(CC_LINE);
    if (match) return { index: i, remainder: match[2].trim() };
  }
  return null;
}

function splitCcEntries(section) {
  const entries = [];
  let current = [];

  const flush = () => {
    if (current.length > 0) entries.push(current);
    current = [];
  };

  for (const line of section) {
    if (line === '') {
      flush();
      continue;
    }
    if (END_OF_CC.test(line)) break;
    current.push(line);
    // An address ends at its `City, ST ZIP` line, so anything after it starts
    // the next CC — letters separate them by paragraph spacing, not blank lines.
    if (parseCityStateZip(line)) flush();
  }

  flush();
  return entries;
}

/** Pull "(via certified mail)" or "- via email" out of a line. */
function extractInlineMethod(line) {
  const patterns = [/\(([^)]*)\)\s*$/, /[-–—]\s*(via\s+[^,]+)$/i, /\b(via\s+[^,()]+)$/i];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const { mailClass, otherMethods } = detectDeliveryMethod(match[1]);
    if (mailClass || otherMethods.length > 0) {
      return { mailClass, otherMethods, cleaned: line.slice(0, match.index).replace(/[\s,;-]+$/, '').trim() };
    }
  }
  return { mailClass: null, otherMethods: [], cleaned: line };
}

/**
 * Extract mailing details from the text of an open Word document.
 *
 * @param {string} documentText
 * @param {object} [options]
 * @param {string} [options.excludeLine1] the firm's own street, so letterhead is skipped
 * @param {string} [options.excludeCompany] the firm's own name, likewise
 * @returns {{
 *   mailClass: string,
 *   deliveryLine: string|null,
 *   deliveryDetected: boolean,
 *   otherMethods: string[],
 *   recipient: object|null,
 *   cc: object[],
 *   subject: string|null,
 *   warnings: string[]
 * }}
 */
export function parseLetter(documentText, options = {}) {
  const lines = toLines(documentText);
  const warnings = [];

  // ------------------------------------------------ delivery method (top) --
  let deliveryIndex = -1;
  let deliveryLine = null;
  let mailClass = null;
  let otherMethods = [];

  const headerScanEnd = Math.min(lines.length, 20);
  for (let i = 0; i < headerScanEnd; i += 1) {
    if (!lines[i] || !isDeliveryHeader(lines[i])) continue;
    const detected = detectDeliveryMethod(lines[i]);
    deliveryIndex = i;
    deliveryLine = lines[i];
    mailClass = detected.mailClass;
    otherMethods = detected.otherMethods;
    break;
  }

  const deliveryDetected = mailClass !== null;
  if (!deliveryDetected) {
    if (deliveryLine) {
      warnings.push(
        `The delivery line "${deliveryLine}" does not name a mail class; defaulting to regular mail.`,
      );
    } else {
      warnings.push('No delivery method line found at the top of the letter; defaulting to regular mail.');
    }
    mailClass = 'regular';
  }

  // ----------------------------------------------------------- recipient --
  const recipient = findRecipient(lines, deliveryIndex, options);
  if (!recipient) {
    warnings.push('Could not find a recipient address; enter it by hand.');
  } else if (recipient.confidence === 'low') {
    warnings.push('The recipient address was only partly recognized — check it before sending.');
  }

  // -------------------------------------------------------------- subject --
  let subject = null;
  for (const line of lines.slice(0, Math.min(lines.length, 60))) {
    const match = line.match(SUBJECT_LINE);
    if (match) {
      // "Re:<tab> - Smith v. Jones" — drop the leading dashes and separators
      // a tabbed template leaves behind.
      subject = match[2].replace(/^[\s\-–—:]+/, '').trim();
      break;
    }
  }

  // ------------------------------------------------------------- cc block --
  const cc = [];
  const ccSection = findCcSection(lines);
  if (ccSection) {
    const sectionLines = [];
    if (ccSection.remainder) sectionLines.push(ccSection.remainder);
    sectionLines.push(...lines.slice(ccSection.index + 1));

    for (const entry of splitCcEntries(sectionLines)) {
      let entryMethod = { mailClass: null, otherMethods: [] };
      const cleanedLines = entry.map((line) => {
        const extracted = extractInlineMethod(line);
        if (extracted.mailClass && !entryMethod.mailClass) entryMethod.mailClass = extracted.mailClass;
        if (extracted.otherMethods.length > 0) {
          entryMethod.otherMethods = [...entryMethod.otherMethods, ...extracted.otherMethods];
        }
        return extracted.cleaned;
      });

      const address = blockToAddress(cleanedLines.filter(Boolean));
      const label = cleanedLines.find(Boolean) ?? '';

      if (!address) {
        // A CC with no address (e.g. "cc: client") still deserves a mention.
        if (label) {
          cc.push({
            name: label,
            mailClass: entryMethod.mailClass ?? mailClass,
            mailClassDetected: Boolean(entryMethod.mailClass),
            otherMethods: entryMethod.otherMethods,
            address_country: 'US',
            confidence: 'none',
            rawBlock: entry,
          });
          warnings.push(`CC "${label}" has no mailing address in the letter; add one or uncheck it.`);
        }
        continue;
      }

      cc.push({
        ...address,
        mailClass: entryMethod.mailClass ?? mailClass,
        mailClassDetected: Boolean(entryMethod.mailClass),
        otherMethods: entryMethod.otherMethods,
      });
    }
  }

  return {
    mailClass,
    deliveryLine,
    deliveryDetected,
    otherMethods,
    recipient,
    cc,
    subject,
    warnings,
  };
}

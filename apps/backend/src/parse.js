/**
 * POST /api/parse — read a letter's recipient block for PLEJ.
 *
 * PLEJ's mailing dialog pre-fills its form from the letter it is about to mail
 * (PLEJ decision M-02), and the letter format is defined once, here, by the
 * Word add-in's parser (M-03). This module does not parse anything itself: it
 * calls that same `parseLetter`, with the same exclusions the task pane passes
 * (`taskpane.js`: the firm's own street and name, so the letterhead and the
 * signature block are never taken for the addressee), and reshapes the answer
 * into what PLEJ's client reads (`parseRecipients` in PLEJ's
 * `packages/mail/src/mailServiceClient.ts`):
 *
 *   { recipient?, cc: [], mailClass?, subject? }
 *   address: { name, company?, line1, line2?, city, state, zip }
 *
 * Everything returned is a suggestion a lawyer confirms in an editable form.
 * Nothing here sends mail, and nothing here writes the text or what was read
 * from it to the log.
 */

import { parseLetter, toLines, STATE_NAMES } from '../../word-addin/public/js/parse-letter.js';

/**
 * The most text one request may carry. PLEJ sends at most 4,000 characters,
 * and a recipient block sits in the first 500. The parser's line patterns are
 * quadratic at worst on one long line of short words, so this ceiling is also
 * the time bound: under about 100 ms at 8,000 characters, measured.
 */
export const MAX_PARSE_TEXT_CHARS = 8_000;

const letterCount = (value) => (String(value ?? '').match(/[A-Za-z]/g) || []).length;
const digitCount = (value) => (String(value ?? '').match(/\d/g) || []).length;
const PO_BOX = /^\s*(p\.?\s?o\.?\s+box|post\s+office\s+box)\s+\d/i;
const UNIT_LINE =
  /^((suite|ste|apt|apartment|unit|floor|fl|room|rm|building|bldg)\b\.?\s*#?\s*([A-Za-z]?\d[\w-]*|[A-Za-z])|(#|no\.?)\s*[A-Za-z]?\d[\w-]*)$/i;
const STREET_WORD =
  /\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|circle|cir|place|pl|plaza|parkway|pkwy|highway|hwy|route|rte|terrace|trail|way|square|sq)\b\.?/i;
const ORGANIZATION_WORD =
  /\b(llc|l\.l\.c|inc|corp|corporation|company|co|ltd|lp|llp|p\.c|pc|associates|partners|group|firm|bank|trust|insurance|holdings|stores|department|university)\b\.?/i;
const PO_BOX_ANYWHERE = /\b(p\.?\s?o\.?\s*box|post\s+office\s+box)\b/i;
const CC_MARKER = /^\s*(cc|c\.c\.|ccs|copy\s+to|copies\s+to)\s*([:\uFF1A]|$)/i;
const CARE_OF = /(^|\s)(c\/o|care\s+of)(\s|$)/i;
const DANGLING_CONJUNCTION = /(\s(and|&)$)|(^(and|&)\s)/i;

/**
 * Checks every address must pass before PLEJ may pre-fill it. Ben tolerates a
 * blank, never a wrong address, so each rule rejects the whole candidate
 * (the answer becomes "nothing") rather than repairing it. `address` is the
 * parser's answer, including `rawBlock`, the lines it was read from.
 * Each rule has an id so the tests can switch one off and show what breaks.
 */
export const ADDRESS_RULES = [
  // A street with no letters ("48217") is a stray number, not a street.
  { id: 'street-has-letter', test: (a) => letterCount(a.address_line1) > 0 },
  // A street (or second line) that is mostly digits is a stray numeric string.
  {
    id: 'street-mostly-digits',
    test: (a) =>
      [a.address_line1, a.address_line2].every(
        (line) => !line || PO_BOX.test(line) || digitCount(line) <= letterCount(line),
      ),
  },
  // Any line of the block that is only digits/punctuation means the block was
  // broken up by the PDF layout (wrapped street, page number); do not guess.
  { id: 'no-letterless-line', test: (a) => (a.rawBlock ?? []).every((line) => letterCount(line) > 0) },
  // PLEJ has no c/o field, and the parser used to put the c/o line in the
  // name. A c/o block is therefore left blank for the lawyer to type.
  { id: 'no-care-of', test: (a) => (a.rawBlock ?? []).every((line) => !CARE_OF.test(line)) },
  // Line 1 of a US street address starts with a number, or is a P.O. box.
  // (The parser takes the line above the city when it sees no street.)
  { id: 'street-starts-with-number-or-box', test: (a) => /^\d/.test(a.address_line1 ?? '') || PO_BOX.test(a.address_line1 ?? '') },
  // Line 1 is a street: a number AND a street word (or a P.O. box), never an
  // organization ("7 Eleven Stores Inc"), a date ("2 September 2026") or a title.
  {
    id: 'street-has-street-word-no-org',
    test: (a) => {
      const line1 = a.address_line1 ?? '';
      if (PO_BOX.test(line1)) return true;
      return STREET_WORD.test(line1) && !ORGANIZATION_WORD.test(line1);
    },
  },
  // "PO Box 4410 100 Example Avenue" is two addresses glued together.
  {
    id: 'po-box-not-fused',
    test: (a) => !PO_BOX_ANYWHERE.test(a.address_line1 ?? '') || (PO_BOX.test(a.address_line1) && !STREET_WORD.test(a.address_line1)),
  },
  // A city is a short run of words. Digits, commas or "Re:" mean the line is
  // something else that happened to end in "ST 12345".
  {
    id: 'city-is-clean',
    test: (a) => /^[A-Za-z][A-Za-z .'-]{0,29}$/.test(a.address_city ?? '') && (a.address_city.match(/\S+/g) || []).length <= 4,
  },
  // "Springfield Illinois, IL" has the state glued onto the city. Only the END
  // is checked, so Kansas City and Washington Court House stay valid.
  {
    id: 'city-not-ending-in-state',
    test: (a) => {
      const words = String(a.address_city ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return !(words.length > 1 && [1, 2].some((n) => words.length > n && STATE_NAMES[words.slice(-n).join(' ')]));
    },
  },
  { id: 'zip-not-zeros', test: (a) => !/^0{5}/.test(a.address_zip ?? '') },
  // Two address blocks that are not the firm's own before the salutation (a
  // second firm's letterhead, a cc block) mean we cannot tell the addressee.
  { id: 'single-candidate', test: (a, ctx) => !ctx || ctx.candidates === 1 },
  // Nothing at or after a "cc:" line is the addressee.
  {
    id: 'no-cc-above',
    test: (a, ctx) => !ctx || !ctx.lines.slice(0, ctx.cityIndex).some((line) => CC_MARKER.test(line)),
  },
  // A second street line must be a unit ("Suite 200"), not half a wrapped street.
  { id: 'line2-is-a-unit', test: (a) => !a.address_line2 || UNIT_LINE.test(a.address_line2.trim()) },
  // "Dana Sample and" / "Robin Example": a two-line name is not person + company.
  { id: 'no-dangling-conjunction', test: (a) => (a.rawBlock ?? []).every((line) => !DANGLING_CONJUNCTION.test(line.trim())) },
];

function present(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * The parser's Lob-shaped address as PLEJ's address, or undefined when any
 * field PLEJ requires is missing — PLEJ would discard it anyway, and a
 * half-filled address shown as "read from the letter" is worse than none.
 */
function toPlejAddress(address, rules = ADDRESS_RULES, ctx) {
  if (!address) return undefined;
  if (!rules.every((rule) => rule.test(address, ctx))) return undefined;
  const person = present(address.name);
  const company = present(address.company);
  // PLEJ requires a name. A letter addressed to a company alone names the
  // company, which is what a lawyer would type into that field.
  const name = person ?? company;
  const line1 = present(address.address_line1);
  const city = present(address.address_city);
  const state = present(address.address_state);
  const zip = present(address.address_zip);
  if (!name || !line1 || !city || !state || !zip) return undefined;

  const line2 = present(address.address_line2);
  return {
    name,
    ...(person && company ? { company } : {}),
    line1,
    ...(line2 ? { line2 } : {}),
    city,
    state,
    zip,
  };
}

/**
 * @param {string} text the document's extracted text
 * @param {object} returnAddress `config.returnAddress`
 */
export function parseForPlej(text, returnAddress, rules = ADDRESS_RULES) {
  const parsed = parseLetter(text, {
    excludeLine1: returnAddress?.address_line1,
    excludeCompany: returnAddress?.company || returnAddress?.name,
  });

  const recipient = toPlejAddress(parsed.recipient, rules, {
    candidates: parsed.recipientCandidates,
    cityIndex: parsed.recipientCityIndex,
    lines: toLines(text),
  });
  // PLEJ mails every CC it is given, at the one class chosen for the whole
  // send. A copy the letter sends only by email, fax or hand is therefore left
  // out rather than suggested as a paid physical letter. A copy with a postal
  // class of its own is kept; PLEJ mails it at the send's class, which the
  // lawyer confirms.
  const cc = parsed.cc
    .filter((entry) => entry.mailClassDetected || entry.otherMethods.length === 0)
    .map((entry) => toPlejAddress(entry, rules))
    .filter(Boolean);
  const subject = present(parsed.subject);

  return {
    ...(recipient ? { recipient } : {}),
    cc,
    // The parser falls back to regular mail when the letter names no class.
    // Only a class the letter actually states is suggested.
    ...(parsed.deliveryDetected ? { mailClass: parsed.mailClass } : {}),
    ...(subject ? { subject } : {}),
  };
}

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

import { parseLetter } from '../../word-addin/public/js/parse-letter.js';

/**
 * The most text one request may carry. PLEJ sends at most 4,000 characters,
 * and a recipient block sits in the first 500. The parser's line patterns are
 * quadratic at worst on one long line of short words, so this ceiling is also
 * the time bound: about 35 ms at 8,000 characters, measured.
 */
export const MAX_PARSE_TEXT_CHARS = 8_000;

function present(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * The parser's Lob-shaped address as PLEJ's address, or undefined when any
 * field PLEJ requires is missing — PLEJ would discard it anyway, and a
 * half-filled address shown as "read from the letter" is worse than none.
 */
function toPlejAddress(address) {
  if (!address) return undefined;
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
export function parseForPlej(text, returnAddress) {
  const parsed = parseLetter(text, {
    excludeLine1: returnAddress?.address_line1,
    excludeCompany: returnAddress?.company || returnAddress?.name,
  });

  const recipient = toPlejAddress(parsed.recipient);
  const cc = parsed.cc.map(toPlejAddress).filter(Boolean);
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

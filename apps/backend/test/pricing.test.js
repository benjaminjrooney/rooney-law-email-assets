import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRates, estimateLetterCost, sumEstimates, formatMoney, toCents } from '../src/pricing.js';
import { MAIL_CLASSES } from '../src/validate.js';

/** Illustrative rates only — the real ones come from the firm's Lob invoice. */
const RATE_ENV = {
  RATE_BASE: '1.00',
  RATE_EXTRA_PAGE: '0.10',
  RATE_COLOR_BASE: '1.50',
  RATE_COLOR_EXTRA_PAGE: '0.20',
  RATE_CERTIFIED: '5.55',
  RATE_CERTIFIED_RETURN_RECEIPT: '8.46',
  RATE_REGISTERED: '20.00',
};

const rates = loadRates(RATE_ENV);

function estimate(overrides = {}) {
  return estimateLetterCost({
    mailClass: MAIL_CLASSES.regular,
    pages: 2,
    color: false,
    doubleSided: false,
    addressPlacement: 'top_first_page',
    rates,
    ...overrides,
  });
}

test('no rates configured means no estimate, not a zero', () => {
  const unconfigured = loadRates({});
  assert.equal(unconfigured.configured, false);

  const result = estimate({ rates: unconfigured });
  assert.equal(result.available, false);
  assert.equal(result.total, null);
  assert.match(result.notes[0], /rates are not configured/);
});

test('prices a plain two-page letter', () => {
  const result = estimate();
  assert.equal(result.available, true);
  assert.equal(result.total, 1.1, '1.00 base + one extra page at 0.10');
  assert.equal(result.billablePages, 2);
  assert.equal(result.currency, 'USD');
});

test('the inserted address page is counted as a printed page', () => {
  const result = estimate({ addressPlacement: 'insert_blank_page' });
  assert.equal(result.billablePages, 3);
  assert.equal(result.total, 1.2);
  assert.match(result.notes.join(' '), /separate address page/);
});

test('certified adds its fee, and its free cover sheet is not priced', () => {
  const result = estimate({ mailClass: MAIL_CLASSES.certified, addressPlacement: null });
  assert.equal(result.total, toCents(1.0 + 0.1 + 5.55));
  assert.equal(result.billablePages, 2, 'the cover sheet is not billed');
  assert.match(result.notes.join(' '), /not charged for/);

  const withReceipt = estimate({ mailClass: MAIL_CLASSES.certified_return_receipt, addressPlacement: null });
  assert.equal(withReceipt.total, toCents(1.1 + 8.46));
});

test('colour uses its own rates when they are set', () => {
  const result = estimate({ color: true });
  assert.equal(result.total, toCents(1.5 + 0.2));
  assert.match(result.breakdown[0].label, /Colour/);
});

test('colour falls back to the mono rate when no colour rate is set', () => {
  const monoOnly = loadRates({ RATE_BASE: '1.00', RATE_EXTRA_PAGE: '0.10' });
  const result = estimate({ color: true, rates: monoOnly });
  assert.equal(result.total, 1.1);
});

test('a missing extra-service rate withholds the estimate rather than under-quoting', () => {
  const noCertified = loadRates({ RATE_BASE: '1.00', RATE_EXTRA_PAGE: '0.10' });
  const result = estimate({ mailClass: MAIL_CLASSES.certified, rates: noCertified });
  assert.equal(result.available, false);
  assert.equal(result.total, null);
  assert.match(result.notes[0], /No rate is configured for certified/);
});

test('an unreadable page count withholds the estimate', () => {
  const result = estimate({ pages: null });
  assert.equal(result.available, false);
  assert.match(result.notes[0], /page count could not be read/);
});

test('per-sheet pricing halves the count for a double-sided letter', () => {
  const perSheet = loadRates({ ...RATE_ENV, RATE_PRICE_PER_SHEET: 'true' });
  const result = estimate({ pages: 4, doubleSided: true, rates: perSheet });
  assert.equal(result.total, toCents(1.0 + 0.1), '4 pages = 2 sheets, one beyond the first');
  assert.match(result.notes.join(' '), /per printed sheet/);

  const perPage = estimate({ pages: 4, doubleSided: true });
  assert.equal(perPage.total, toCents(1.0 + 0.3), 'per-page pricing is unaffected by sidedness');
});

test('a one-page letter has no additional-page line', () => {
  const result = estimate({ pages: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.breakdown.length, 1);
});

test('totals add up across letters and stay unavailable if any letter is', () => {
  const available = sumEstimates([estimate(), estimate({ pages: 1 })]);
  assert.equal(available.available, true);
  assert.equal(available.total, toCents(1.1 + 1.0));
  assert.equal(available.letters, 2);

  const mixed = sumEstimates([estimate(), estimate({ pages: null })]);
  assert.equal(mixed.available, false);
  assert.equal(mixed.total, null);
});

test('rates are parsed leniently but rejected when nonsense', () => {
  const withSymbols = loadRates({ RATE_BASE: '$1.25', RATE_EXTRA_PAGE: ' 0.15 ' });
  assert.equal(withSymbols.base, 1.25);
  assert.equal(withSymbols.extraPage, 0.15);
  assert.throws(() => loadRates({ RATE_BASE: 'free' }), /Invalid amount for RATE_BASE/);
  assert.throws(() => loadRates({ RATE_BASE: '-1' }), /Invalid amount for RATE_BASE/);
});

test('money formatting is exact to the cent', () => {
  assert.equal(formatMoney(1.1), '$1.10');
  assert.equal(formatMoney(12), '$12.00');
  assert.equal(formatMoney(1.1, 'EUR'), '1.10 EUR');
  assert.equal(formatMoney(null), null);
  assert.equal(toCents(0.1 + 0.2), 0.3, 'no float drift');
});

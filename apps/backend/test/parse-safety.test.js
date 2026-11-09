import test from 'node:test';
import assert from 'node:assert/strict';

import { parseForPlej, ADDRESS_RULES } from '../src/parse.js';

/**
 * "Correct, or blank — never wrong" for the recipient PLEJ pre-fills.
 *
 * Every name, street and number below is invented. No real letter text is
 * used anywhere in this file. Each case is a PDF-like text layout (one visual
 * line per line, no blank lines between paragraphs, letterhead in the body).
 *
 * A case says what a CORRECT answer is (`correct`, or null when the right
 * answer is "nothing") and whether blank is also acceptable (`blankOk`).
 * Anything else the parser returns is a WRONG answer and fails the case.
 */
const RETURN_ADDRESS = {
  name: 'Benjamin J. Rooney',
  company: 'Rooney Law',
  address_line1: '123 North LaSalle Street',
};

const LETTERHEAD = ['Rooney Law, P.C.', '123 North LaSalle Street, Suite 1200', 'Chicago, Illinois 60602'];
const BODY = ['Re: Sample matter', 'Dear Ms. Sample:', 'This firm writes about the contract.', 'Sincerely,', 'Benjamin J. Rooney'];

function letter(block, { head = LETTERHEAD, delivery = 'VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED', date = 'September 2, 2026' } = {}) {
  return [...head, date, ...(delivery ? [delivery] : []), ...block, ...BODY].join('\n');
}

const SAMPLE = {
  name: 'Dana Sample',
  company: 'Sample Holdings, LLC',
  line1: '100 Example Avenue',
  city: 'Springfield',
  state: 'IL',
  zip: '62700',
};

export const CASES = [
  // ----------------------------------------------------------- must be right
  {
    id: 'person, street, city',
    text: letter(['Dana Sample', '100 Example Avenue', 'Springfield, Illinois 62700']),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'person plus company, suite on the street line',
    text: letter(['Dana Sample', 'Sample Holdings, LLC', '100 Example Avenue, Suite 200', 'Springfield, Illinois 62700']),
    correct: { name: 'Dana Sample', company: 'Sample Holdings, LLC', line1: '100 Example Avenue, Suite 200', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'suite on its own line',
    text: letter(['Dana Sample', 'Sample Holdings, LLC', '100 Example Avenue', 'Suite 200', 'Springfield, IL 62700']),
    correct: { name: 'Dana Sample', company: 'Sample Holdings, LLC', line1: '100 Example Avenue', line2: 'Suite 200', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'unit line (Apt)',
    text: letter(['Dana Sample', '100 Example Avenue', 'Apt 4B', 'Springfield, IL 62700']),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', line2: 'Apt 4B', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'floor line',
    text: letter(['Dana Sample', '100 Example Avenue', 'Floor 3', 'Springfield, IL 62700']),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', line2: 'Floor 3', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'company line above the person',
    text: letter(['Sample Holdings, LLC', 'Dana Sample', '100 Example Avenue', 'Springfield, IL 62700']),
    correct: { name: 'Dana Sample', company: 'Sample Holdings, LLC', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'company only',
    text: letter(['Sample Holdings, LLC', '100 Example Avenue', 'Springfield, IL 62700']),
    correct: { name: 'Sample Holdings, LLC', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'attention line',
    text: letter(['Sample Holdings, LLC', 'Attn: Claims Department', '100 Example Avenue', 'Springfield, IL 62700']),
    correct: { name: 'Claims Department', company: 'Sample Holdings, LLC', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'ZIP+4',
    text: letter(['Dana Sample', '100 Example Avenue', 'Springfield, Illinois 62700-1234']),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700-1234' },
  },
  {
    id: 'P.O. Box',
    text: letter(['Dana Sample', 'P.O. Box 4410', 'Springfield, IL 62700']),
    correct: { name: 'Dana Sample', line1: 'P.O. Box 4410', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'ordinal street number',
    text: letter(['Dana Sample', '250 5th Avenue', 'Springfield, IL 62700']),
    correct: { name: 'Dana Sample', line1: '250 5th Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'by certified and regular mail line',
    text: letter(['Dana Sample', '100 Example Avenue', 'Springfield, IL 62700'], { delivery: 'By certified and regular mail' }),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'no delivery line at all',
    text: letter(['Dana Sample', '100 Example Avenue', 'Springfield, IL 62700'], { delivery: null }),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'letterhead with phone and email lines',
    text: letter(['Dana Sample', '100 Example Avenue', 'Springfield, IL 62700'], {
      head: [...LETTERHEAD, 'Tel: 555.000.0000 Direct: 555.000.0001', 'someone@example.test'],
    }),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'right-column letterhead (firm lines sit above, not beside, the block)',
    text: letter(['Dana Sample', '100 Example Avenue', 'Springfield, IL 62700'], {
      head: ['                  Rooney Law, P.C.', '                  123 North LaSalle Street, Suite 1200', '                  Chicago, Illinois 60602'],
    }),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
  },
  {
    id: 'window-envelope letter: small return line above the block',
    text: letter(['Rooney Law, P.C. 123 North LaSalle Street Chicago IL 60602', 'Dana Sample', '100 Example Avenue', 'Springfield, IL 62700'], { head: [] }),
    correct: { name: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' },
    blankOk: true, // a one-line return address above the block is ambiguous; blank is safe
  },

  // ------------------------------------------- the failing shape from the spike
  {
    id: 'WRONG-CASE street broken across lines with a stray numeric string',
    text: letter(['Dana Sample', 'Sample Holdings, LLC', '4821 7', '100 Example', 'Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'WRONG-CASE stray numeric line is the only thing above the city',
    text: letter(['Dana Sample', 'Sample Holdings, LLC', '48217', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'WRONG-CASE bare number then a company-looking line',
    text: letter(['Dana Sample', '48217', 'Example Partners Group', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'street line is digits and punctuation only',
    text: letter(['Dana Sample', '100-200', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'wrapped street (number on one line, street name on the next)',
    text: letter(['Dana Sample', '100', 'Example Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'street wrapped after the name part',
    text: letter(['Dana Sample', '100 Example', 'Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'street that is mostly digits but has a letter',
    text: letter(['Dana Sample', '48217 55 B', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'page number stray line inside block',
    text: letter(['Dana Sample', '2', '100 Example Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },

  // ----------------------------------------------------------------- c/o
  {
    id: 'WRONG-CASE c/o block (c/o line was becoming the name)',
    text: letter(['c/o Robin Example', 'Dana Sample', '100 Example Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'c/o line below the person, with a company',
    text: letter(['Sample Holdings, LLC', 'c/o Robin Example', '100 Example Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'care of spelled out',
    text: letter(['Dana Sample', 'Care of Robin Example', '100 Example Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },

  // --------------------------------------------- shapes that must never be wrong
  {
    id: 'two-line name',
    text: letter(['Dana Sample and', 'Robin Example', '100 Example Avenue', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'two-column letterhead: columns read across (firm and addressee on one line)',
    text: letter(['Rooney Law, P.C.          Dana Sample', '123 North LaSalle Street   100 Example Avenue', 'Chicago, IL 60602          Springfield, IL 62700'], { head: [] }),
    correct: null,
    blankOk: true,
  },
  {
    id: 'spelled-out street number',
    text: letter(['Dana Sample', 'Sample Holdings, LLC', 'One Example Plaza', 'Springfield, Illinois 62700']),
    correct: { name: 'Dana Sample', company: 'Sample Holdings, LLC', line1: 'One Example Plaza', city: 'Springfield', state: 'IL', zip: '62700' },
    blankOk: true,
  },
  {
    id: 'foreign address (UK)',
    text: letter(['Dana Sample', '10 Example Road', 'London SW1A 1AA', 'United Kingdom']),
    correct: null,
  },
  {
    id: 'foreign address (Canada)',
    text: letter(['Dana Sample', '10 Example Road', 'Toronto, ON M5V 2T6', 'Canada']),
    correct: null,
  },
  {
    id: 'email-only letter',
    text: letter(['Dana Sample', 'sample@example.test'], { delivery: 'VIA EMAIL ONLY' }),
    correct: null,
  },
  {
    id: 'no street at all',
    text: letter(['Dana Sample', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'name line mistaken for a street (no digit, no street word)',
    text: letter(['Dana Sample', 'Sample Holdings, LLC', 'Springfield, Illinois 62700']),
    correct: null,
  },
  {
    id: 'ZIP split by a space (OCR)',
    text: letter(['Dana Sample', '100 Example Avenue', 'Springfield, Illinois 627 00']),
    correct: null,
  },
  {
    id: 'body prose only, no block',
    text: ['Dear Ms. Sample:', 'Please see 100 Example Avenue, Springfield, IL 62700 for the site.'].join('\n'),
    correct: null,
  },
];

function shapeOf(recipient) {
  return recipient ? JSON.parse(JSON.stringify(recipient)) : undefined;
}

function verdict(c, result) {
  const got = shapeOf(result.recipient);
  if (got === undefined) return c.correct === null || c.blankOk ? 'ok-blank' : 'unexpected-blank';
  if (c.correct && JSON.stringify(got) === JSON.stringify(c.correct)) return 'ok-correct';
  return 'WRONG';
}

test('corpus has at least 30 layouts', () => {
  assert.ok(CASES.length >= 30, `only ${CASES.length}`);
});

for (const c of CASES) {
  test(`corpus: ${c.id}`, () => {
    const v = verdict(c, parseForPlej(c.text, RETURN_ADDRESS));
    assert.notEqual(v, 'WRONG', `a wrong address would pre-fill: ${JSON.stringify(parseForPlej(c.text, RETURN_ADDRESS).recipient)}`);
    assert.notEqual(v, 'unexpected-blank', 'a positive control came back blank');
  });
}

// ------------------------------------------------------------ property check
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = [
  'Dana Sample', 'Sample Holdings, LLC', 'Robin Example', 'Example Partners Group', 'Attn: Claims Department',
  'c/o Robin Example', 'Care of Robin Example', '100 Example Avenue', '100 Example', 'Avenue', 'Suite 200', 'Apt 4B',
  'P.O. Box 4410', '48217', '4821 7', '100-200', '7', '2', '1200 5th Avenue', 'One Example Plaza', '55 7 9',
  'Dana Sample and', '#5', 'Floor 3', '90210 12345', '(555) 000-0000',
];
const CITIES = ['Springfield, Illinois 62700', 'Springfield, IL 62700-1234', 'Othertown, IL 60002'];

function noLetterlessStreet(r) {
  const letters = (s) => (s.match(/[A-Za-z]/g) || []).length;
  const digits = (s) => (s.match(/\d/g) || []).length;
  assert.ok(letters(r.line1) > 0, `street without a letter: ${r.line1}`);
  assert.ok(digits(r.line1) <= letters(r.line1) || /box/i.test(r.line1), `street mostly digits: ${r.line1}`);
  if (r.line2) assert.ok(letters(r.line2) > 0, `line2 without a letter: ${r.line2}`);
  assert.ok(letters(r.name) > 0, `name without a letter: ${r.name}`);
  if (r.company) assert.ok(letters(r.company) > 0);
  for (const value of Object.values(r)) assert.doesNotMatch(String(value), /\bc\/o\b|\bcare of\b/i, 'c/o leaked into a field');
}

test('property: no output ever has a street without a letter, a mostly-digit street, or c/o in a field', () => {
  const rand = mulberry32(20261109);
  let produced = 0;
  for (let i = 0; i < 4000; i += 1) {
    const n = 1 + Math.floor(rand() * 5);
    const block = Array.from({ length: n }, () => POOL[Math.floor(rand() * POOL.length)]);
    block.push(CITIES[Math.floor(rand() * CITIES.length)]);
    const out = parseForPlej(letter(block), RETURN_ADDRESS);
    for (const entry of [out.recipient, ...out.cc].filter(Boolean)) {
      produced += 1;
      noLetterlessStreet(entry);
    }
  }
  assert.ok(produced > 50, 'the property run never produced an address, so it proves nothing');
});

test('property also holds for cc entries', () => {
  const text = ['Dear Ms. Sample:', 'Body.', 'cc: Robin Example', '48217', '4821 7', 'Springfield, IL 62700'].join('\n');
  const out = parseForPlej(text, RETURN_ADDRESS);
  assert.deepEqual(out.cc, []);
});

// ------------------------------------------------------------ mutation tests
// Each named rule is switched off in turn; the case it exists for must go RED
// (the corpus must then contain a wrong answer). If a mutation leaves the
// corpus green, the rule is not protecting anything and the test fails.
function corpusWrongWith(rules) {
  return CASES.filter((c) => verdict(c, parseForPlej(c.text, RETURN_ADDRESS, rules)) === 'WRONG').map((c) => c.id);
}

test('mutation baseline: the full rule set leaves the corpus with no wrong answer', () => {
  assert.deepEqual(corpusWrongWith(ADDRESS_RULES), []);
});

const MUTATIONS = [
  {
    name: 'the digit/letter rule (street needs a letter, is not mostly digits, no letterless line)',
    remove: ['street-has-letter', 'street-mostly-digits', 'no-letterless-line'],
    mustGoRed: 'WRONG-CASE stray numeric line is the only thing above the city',
  },
  { name: 'no-letterless-line', remove: ['no-letterless-line'], mustGoRed: 'page number stray line inside block' },
  { name: 'street-mostly-digits', remove: ['street-mostly-digits'], mustGoRed: 'street that is mostly digits but has a letter' },
  { name: 'no-care-of', remove: ['no-care-of'], mustGoRed: 'WRONG-CASE c/o block (c/o line was becoming the name)' },
  { name: 'street-starts-with-number-or-box', remove: ['street-starts-with-number-or-box'], mustGoRed: 'name line mistaken for a street (no digit, no street word)' },
  { name: 'line2-is-a-unit', remove: ['line2-is-a-unit'], mustGoRed: 'street wrapped after the name part' },
  { name: 'no-dangling-conjunction', remove: ['no-dangling-conjunction'], mustGoRed: 'two-line name' },
];

for (const { name, remove, mustGoRed } of MUTATIONS) {
  test(`mutation: removing ${name} turns "${mustGoRed}" red`, () => {
    for (const id of remove) assert.ok(ADDRESS_RULES.some((r) => r.id === id), `no such rule: ${id}`);
    const wrong = corpusWrongWith(ADDRESS_RULES.filter((r) => !remove.includes(r.id)));
    assert.ok(wrong.includes(mustGoRed), `removing ${name} did not break "${mustGoRed}"; broke: ${JSON.stringify(wrong)}`);
  });
}

test('mutation: swapping c/o into name/company (the old behaviour) is caught', () => {
  // The unfixed parser made the c/o line the name and the addressee the company.
  const c = CASES.find((x) => x.id.startsWith('WRONG-CASE c/o block'));
  const swapped = { recipient: { name: 'Robin Example', company: 'Dana Sample', line1: '100 Example Avenue', city: 'Springfield', state: 'IL', zip: '62700' } };
  assert.equal(verdict(c, swapped), 'WRONG');
});

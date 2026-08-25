import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLetter,
  parseAddressBlock,
  parseCityStateZip,
  parseInlineAddress,
  detectDeliveryMethod,
  toLines,
} from '../public/js/parse-letter.js';

const LETTERHEAD = [
  'ROONEY LAW',
  '123 North LaSalle Street, Suite 1200',
  'Chicago, Illinois 60602',
  '',
  'August 25, 2026',
  '',
];

function letter(lines) {
  return lines.join('\n');
}

test('parseCityStateZip handles abbreviations, full state names and ZIP+4', () => {
  assert.deepEqual(parseCityStateZip('Chicago, IL 60601'), {
    address_city: 'Chicago',
    address_state: 'IL',
    address_zip: '60601',
  });
  assert.deepEqual(parseCityStateZip('Chicago, Illinois 60661-1234'), {
    address_city: 'Chicago',
    address_state: 'IL',
    address_zip: '60661-1234',
  });
  assert.deepEqual(parseCityStateZip('Oak Park, Ill. 60302'), null, 'unknown state spellings are rejected');
  assert.equal(parseCityStateZip('Dear Ms. Doe:'), null);
});

test('detectDeliveryMethod ranks return receipt above plain certified', () => {
  assert.equal(
    detectDeliveryMethod('VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED').mailClass,
    'certified_return_receipt',
  );
  assert.equal(detectDeliveryMethod('VIA CERTIFIED MAIL').mailClass, 'certified');
  assert.equal(detectDeliveryMethod('VIA REGISTERED MAIL').mailClass, 'registered');
  assert.equal(detectDeliveryMethod('VIA FIRST-CLASS MAIL').mailClass, 'regular');
  assert.equal(detectDeliveryMethod('VIA HAND DELIVERY').mailClass, null);
  assert.deepEqual(detectDeliveryMethod('VIA EMAIL AND CERTIFIED MAIL'), {
    mailClass: 'certified',
    otherMethods: ['email'],
  });
});

test('parseAddressBlock splits person, company, street and city lines', () => {
  const address = parseAddressBlock([
    'Jane Doe, Esq.',
    'Doe & Associates LLC',
    '500 West Madison Street, Suite 1000',
    'Chicago, Illinois 60661',
  ]);
  assert.equal(address.name, 'Jane Doe, Esq.');
  assert.equal(address.company, 'Doe & Associates LLC');
  assert.equal(address.address_line1, '500 West Madison Street, Suite 1000');
  assert.equal(address.address_city, 'Chicago');
  assert.equal(address.address_state, 'IL');
  assert.equal(address.address_zip, '60661');
  assert.equal(address.confidence, 'high');
});

test('parseAddressBlock keeps a standalone suite line as address_line2', () => {
  const address = parseAddressBlock([
    'Acme Property Management, Inc.',
    '77 West Wacker Drive',
    'Suite 3100',
    'Chicago, IL 60601',
  ]);
  assert.equal(address.company, 'Acme Property Management, Inc.');
  assert.equal(address.name, undefined);
  assert.equal(address.address_line1, '77 West Wacker Drive');
  assert.equal(address.address_line2, 'Suite 3100');
});

test('parseAddressBlock handles PO boxes and ATTN lines', () => {
  const address = parseAddressBlock([
    'Midwest Insurance Company',
    'Attn: Claims Department',
    'P.O. Box 4820',
    'Springfield, Illinois 62705',
  ]);
  assert.equal(address.company, 'Midwest Insurance Company');
  assert.equal(address.name, 'Claims Department');
  assert.equal(address.address_line1, 'P.O. Box 4820');
  assert.equal(address.address_zip, '62705');
});

test('parseInlineAddress reads a one-line CC address', () => {
  const address = parseInlineAddress('Robert Roe, 1 North Wacker Drive, Chicago, IL 60606');
  assert.equal(address.name, 'Robert Roe');
  assert.equal(address.address_line1, '1 North Wacker Drive');
  assert.equal(address.address_city, 'Chicago');
  assert.equal(address.address_zip, '60606');
});

test('parses a full certified letter with a CC block', () => {
  const text = letter([
    ...LETTERHEAD,
    'VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED',
    '',
    'Jane Doe, Esq.',
    'Doe & Associates LLC',
    '500 West Madison Street, Suite 1000',
    'Chicago, Illinois 60661',
    '',
    'Re: Smith v. Jones, Case No. 2026 L 001234',
    '',
    'Dear Ms. Doe:',
    '',
    'This firm represents Mr. Smith. Prior demands were sent by certified mail and',
    'have gone unanswered.',
    '',
    'Sincerely,',
    '',
    'Benjamin J. Rooney',
    '',
    'cc: Robert Roe (via regular mail)',
    'Roe Law Group',
    '1 North Wacker Drive',
    'Chicago, IL 60606',
  ]);

  const result = parseLetter(text, { excludeZip: '60602', excludeCompany: 'Rooney Law' });

  assert.equal(result.mailClass, 'certified_return_receipt');
  assert.equal(result.deliveryDetected, true);
  assert.equal(result.deliveryLine, 'VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED');
  assert.equal(result.subject, 'Smith v. Jones, Case No. 2026 L 001234');

  assert.equal(result.recipient.name, 'Jane Doe, Esq.');
  assert.equal(result.recipient.company, 'Doe & Associates LLC');
  assert.equal(result.recipient.address_line1, '500 West Madison Street, Suite 1000');
  assert.equal(result.recipient.address_city, 'Chicago');
  assert.equal(result.recipient.address_state, 'IL');
  assert.equal(result.recipient.address_zip, '60661');

  assert.equal(result.cc.length, 1);
  assert.equal(result.cc[0].name, 'Robert Roe');
  assert.equal(result.cc[0].company, 'Roe Law Group');
  assert.equal(result.cc[0].address_line1, '1 North Wacker Drive');
  assert.equal(result.cc[0].mailClass, 'regular');
  assert.equal(result.cc[0].mailClassDetected, true);
  assert.deepEqual(result.warnings, []);
});

test('never picks the firm letterhead as the recipient', () => {
  const text = letter([
    ...LETTERHEAD,
    'Mr. John Smith',
    '1234 South Ashland Avenue',
    'Chicago, IL 60608',
    '',
    'Dear Mr. Smith:',
    '',
    'Please call the office at your convenience.',
  ]);

  const result = parseLetter(text, { excludeZip: '60602', excludeCompany: 'Rooney Law' });
  assert.equal(result.recipient.name, 'Mr. John Smith');
  assert.equal(result.recipient.address_zip, '60608');
});

test('defaults to regular mail when no delivery line is present', () => {
  const text = letter([
    ...LETTERHEAD,
    'Mr. John Smith',
    '1234 South Ashland Avenue',
    'Chicago, IL 60608',
    '',
    'Dear Mr. Smith:',
  ]);

  const result = parseLetter(text, { excludeZip: '60602' });
  assert.equal(result.mailClass, 'regular');
  assert.equal(result.deliveryDetected, false);
  assert.match(result.warnings[0], /No delivery method line/);
});

test('defaults to regular mail when the top line names only a non-mail method', () => {
  const text = letter([
    ...LETTERHEAD,
    'VIA HAND DELIVERY',
    '',
    'Mr. John Smith',
    '1234 South Ashland Avenue',
    'Chicago, IL 60608',
    '',
    'Dear Mr. Smith:',
  ]);

  const result = parseLetter(text, { excludeZip: '60602' });
  assert.equal(result.mailClass, 'regular');
  assert.equal(result.deliveryDetected, false);
  assert.deepEqual(result.otherMethods, ['hand']);
  assert.match(result.warnings[0], /does not name a mail class/);
});

test('body prose about certified mail does not become the delivery method', () => {
  const text = letter([
    'ROONEY LAW',
    '',
    'August 25, 2026',
    '',
    'Mr. John Smith',
    '1234 South Ashland Avenue',
    'Chicago, IL 60608',
    '',
    'Dear Mr. Smith:',
    '',
    'Our prior notice was sent by certified mail on July 1, 2026.',
  ]);

  const result = parseLetter(text);
  assert.equal(result.deliveryDetected, false);
  assert.equal(result.mailClass, 'regular');
});

test('reads multiple CC recipients with per-recipient delivery methods', () => {
  const text = letter([
    ...LETTERHEAD,
    'VIA FIRST-CLASS MAIL',
    '',
    'Mr. John Smith',
    '1234 South Ashland Avenue',
    'Chicago, IL 60608',
    '',
    'Dear Mr. Smith:',
    '',
    'Sincerely,',
    'Benjamin J. Rooney',
    '',
    'cc: Jane Doe, Esq. (via certified mail, return receipt requested)',
    'Doe & Associates LLC',
    '500 West Madison Street',
    'Chicago, IL 60661',
    '',
    'Robert Roe - via regular mail',
    '1 North Wacker Drive',
    'Chicago, IL 60606',
    '',
    'Enclosures',
  ]);

  const result = parseLetter(text, { excludeZip: '60602' });
  assert.equal(result.mailClass, 'regular');
  assert.equal(result.cc.length, 2);
  assert.equal(result.cc[0].name, 'Jane Doe, Esq.');
  assert.equal(result.cc[0].mailClass, 'certified_return_receipt');
  assert.equal(result.cc[1].name, 'Robert Roe');
  assert.equal(result.cc[1].mailClass, 'regular');
});

test('a CC with no delivery method inherits the letter delivery method', () => {
  const text = letter([
    ...LETTERHEAD,
    'VIA CERTIFIED MAIL',
    '',
    'Mr. John Smith',
    '1234 South Ashland Avenue',
    'Chicago, IL 60608',
    '',
    'Dear Mr. Smith:',
    '',
    'cc: Robert Roe',
    '1 North Wacker Drive',
    'Chicago, IL 60606',
  ]);

  const result = parseLetter(text, { excludeZip: '60602' });
  assert.equal(result.cc[0].mailClass, 'certified');
  assert.equal(result.cc[0].mailClassDetected, false);
});

test('a CC without an address is reported but not silently dropped', () => {
  const text = letter([
    ...LETTERHEAD,
    'VIA CERTIFIED MAIL',
    '',
    'Mr. John Smith',
    '1234 South Ashland Avenue',
    'Chicago, IL 60608',
    '',
    'Dear Mr. Smith:',
    '',
    'cc: Client',
  ]);

  const result = parseLetter(text, { excludeZip: '60602' });
  assert.equal(result.cc.length, 1);
  assert.equal(result.cc[0].name, 'Client');
  assert.equal(result.cc[0].confidence, 'none');
  assert.match(result.warnings.join(' '), /no mailing address/);
});

test('handles Word paragraph marks and soft line breaks', () => {
  const text = ['VIA CERTIFIED MAIL', '', 'Mr. John Smith\u000B1234 South Ashland Avenue', 'Chicago, IL 60608', '', 'Dear Mr. Smith:'].join('\r');
  const result = parseLetter(text);
  assert.equal(result.mailClass, 'certified');
  assert.equal(result.recipient.name, 'Mr. John Smith');
  assert.equal(result.recipient.address_line1, '1234 South Ashland Avenue');
});

test('toLines collapses runs of whitespace', () => {
  assert.deepEqual(toLines('  a   b \r\n c\t\td '), ['a b', 'c d']);
});

test('reports a warning when no recipient can be found', () => {
  const result = parseLetter('Just some prose with no address at all.');
  assert.equal(result.recipient, null);
  assert.match(result.warnings.join(' '), /Could not find a recipient address/);
});

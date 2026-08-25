import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateLetterRequest,
  normalizeAddress,
  looksLikePdf,
  estimatePageCount,
  MAIL_CLASSES,
} from '../src/validate.js';
import { testConfig, samplePdf, VALID_PAYLOAD } from './helpers.js';

const config = testConfig();

test('normalizeAddress trims, uppercases the state and drops unknown fields', () => {
  const address = normalizeAddress({
    name: '  Jane   Doe ',
    address_state: 'il',
    address_zip: '60661',
    address_line1: '500 W Madison',
    address_city: 'Chicago',
    nickname: 'drop me',
  });
  assert.equal(address.name, 'Jane Doe');
  assert.equal(address.address_state, 'IL');
  assert.equal(address.address_country, 'US');
  assert.equal(address.nickname, undefined);
});

test('a complete request validates and picks up the configured return address', () => {
  const { errors, value } = validateLetterRequest(VALID_PAYLOAD, config);
  assert.deepEqual(errors, []);
  assert.equal(value.mailClass.mailType, 'usps_first_class');
  assert.equal(value.mailClass.extraService, null);
  assert.equal(value.from.company, 'Rooney Law');
  assert.equal(value.from.address_zip, '60602');
  assert.equal(value.options.addressPlacement, 'insert_blank_page');
});

test('certified classes map onto the right Lob extra services', () => {
  assert.equal(MAIL_CLASSES.certified.extraService, 'certified');
  assert.equal(MAIL_CLASSES.certified_return_receipt.extraService, 'certified_return_receipt');
  assert.equal(MAIL_CLASSES.registered.extraService, 'registered');
  for (const mailClass of Object.values(MAIL_CLASSES)) {
    assert.equal(mailClass.mailType, 'usps_first_class', 'legal mail is never marketing-class');
  }
});

test('missing recipient fields are reported one per field', () => {
  const { errors } = validateLetterRequest(
    { to: { name: 'Jane Doe', address_city: 'Chicago' }, mailClass: 'certified' },
    config,
  );
  assert.ok(errors.some((error) => /street address is required/.test(error)));
  assert.ok(errors.some((error) => /state is required/.test(error)));
  assert.ok(errors.some((error) => /ZIP code is required/.test(error)));
});

test('a recipient with only a company is accepted', () => {
  const { errors } = validateLetterRequest(
    {
      to: {
        company: 'Midwest Insurance Company',
        address_line1: 'P.O. Box 4820',
        address_city: 'Springfield',
        address_state: 'IL',
        address_zip: '62705',
      },
    },
    config,
  );
  assert.deepEqual(errors, []);
});

test('bad ZIP codes and states are rejected with readable messages', () => {
  const { errors } = validateLetterRequest(
    { to: { ...VALID_PAYLOAD.to, address_zip: '6066', address_state: 'Illinois' } },
    config,
  );
  assert.ok(errors.some((error) => /ZIP code must look like/.test(error)));
  assert.ok(errors.some((error) => /two-letter abbreviation/.test(error)));
});

test('an unknown mail class is rejected rather than silently downgraded', () => {
  const { errors } = validateLetterRequest({ ...VALID_PAYLOAD, mailClass: 'owl' }, config);
  assert.ok(errors.some((error) => /Unknown mail class "owl"/.test(error)));
});

test('CC recipients inherit the letter mail class unless they set their own', () => {
  const { value } = validateLetterRequest(
    {
      ...VALID_PAYLOAD,
      mailClass: 'certified',
      cc: [
        { ...VALID_PAYLOAD.to, name: 'Robert Roe' },
        { ...VALID_PAYLOAD.to, name: 'Sam Poe', mailClass: 'regular' },
      ],
    },
    config,
  );
  assert.equal(value.cc[0].mailClass.id, 'certified');
  assert.equal(value.cc[1].mailClass.id, 'regular');
});

test('an invalid CC address fails the whole request', () => {
  const { errors } = validateLetterRequest(
    { ...VALID_PAYLOAD, cc: [{ name: 'Robert Roe' }] },
    config,
  );
  assert.ok(errors.some((error) => /CC recipient 1: street address is required/.test(error)));
});

test('metadata values are coerced to strings and capped', () => {
  const { value } = validateLetterRequest(
    { ...VALID_PAYLOAD, metadata: { matter: 12345, blank: '', long: 'x'.repeat(900) } },
    config,
  );
  assert.equal(value.metadata.matter, '12345');
  assert.equal(value.metadata.blank, undefined);
  assert.equal(value.metadata.long.length, 500);
});

test('looksLikePdf only accepts a real PDF header', () => {
  assert.equal(looksLikePdf(samplePdf()), true);
  assert.equal(looksLikePdf(Buffer.from('PK docx zip')), false);
  assert.equal(looksLikePdf(Buffer.alloc(0)), false);
});

test('estimatePageCount counts page objects', () => {
  assert.equal(estimatePageCount(samplePdf(1)), 1);
  assert.equal(estimatePageCount(samplePdf(7)), 7);
  assert.equal(estimatePageCount(Buffer.from('not a pdf')), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { mailedPdfName, formatFilingDate } from '../public/js/office-export.js';

const AUG_26 = new Date(2026, 7, 26); // months are zero-based

test('dates are written the way the firm names documents', () => {
  assert.equal(formatFilingDate(AUG_26), '2026.8.26');
  assert.equal(formatFilingDate(new Date(2026, 0, 1)), '2026.1.1', 'no leading zeros');
  assert.equal(formatFilingDate(new Date(2026, 11, 31)), '2026.12.31');
});

test('the PDF keeps the document name and records when it was mailed', () => {
  assert.equal(
    mailedPdfName('2026.8.25 Letter to Isaiah.docx', AUG_26),
    '2026.8.25 Letter to Isaiah mailed on 2026.8.26.pdf',
  );
});

test('any Word extension is replaced, and a name without one still works', () => {
  for (const name of ['Smith demand.docx', 'Smith demand.doc', 'Smith demand.dotx', 'Smith demand.rtf']) {
    assert.equal(mailedPdfName(name, AUG_26), 'Smith demand mailed on 2026.8.26.pdf');
  }
  assert.equal(mailedPdfName('Smith demand', AUG_26), 'Smith demand mailed on 2026.8.26.pdf');
});

test('an unsaved or unnamed document still produces a usable name', () => {
  assert.equal(mailedPdfName('', AUG_26), 'Letter mailed on 2026.8.26.pdf');
  assert.equal(mailedPdfName(null, AUG_26), 'Letter mailed on 2026.8.26.pdf');
  assert.equal(mailedPdfName('   ', AUG_26), 'Letter mailed on 2026.8.26.pdf');
});

test('characters Windows and SharePoint reject are replaced', () => {
  assert.equal(
    mailedPdfName('Smith v. Jones: demand/notice?.docx', AUG_26),
    'Smith v. Jones- demand-notice- mailed on 2026.8.26.pdf',
  );
});

test('a very long document name is trimmed but keeps its extension', () => {
  const name = mailedPdfName(`${'x'.repeat(300)}.docx`, AUG_26);
  assert.ok(name.length < 160, `got ${name.length} characters`);
  assert.ok(name.endsWith(' mailed on 2026.8.26.pdf'));
});

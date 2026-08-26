import test from 'node:test';
import assert from 'node:assert/strict';

import { mailedPdfName } from '../public/js/office-export.js';

test('the PDF keeps the document name and is marked as mailed', () => {
  assert.equal(
    mailedPdfName('2026.8.25 Letter to Isaiah.docx'),
    '2026.8.25 Letter to Isaiah (mailed).pdf',
  );
});

test('any Word extension is replaced, and a name without one still works', () => {
  for (const name of ['Smith demand.docx', 'Smith demand.doc', 'Smith demand.dotx', 'Smith demand.rtf']) {
    assert.equal(mailedPdfName(name), 'Smith demand (mailed).pdf');
  }
  assert.equal(mailedPdfName('Smith demand'), 'Smith demand (mailed).pdf');
});

test('an unsaved or unnamed document still produces a usable name', () => {
  assert.equal(mailedPdfName(''), 'Letter (mailed).pdf');
  assert.equal(mailedPdfName(null), 'Letter (mailed).pdf');
  assert.equal(mailedPdfName('   '), 'Letter (mailed).pdf');
});

test('characters Windows and SharePoint reject are replaced', () => {
  assert.equal(
    mailedPdfName('Smith v. Jones: demand/notice?.docx'),
    'Smith v. Jones- demand-notice- (mailed).pdf',
  );
});

test('a very long document name is trimmed but keeps its extension', () => {
  const name = mailedPdfName(`${'x'.repeat(300)}.docx`);
  assert.ok(name.length < 140, `got ${name.length} characters`);
  assert.ok(name.endsWith(' (mailed).pdf'));
});

test('a name that already says mailed is not doubled up', () => {
  // Re-mailing an already-saved copy should not produce "(mailed) (mailed)".
  assert.equal(mailedPdfName('2026.8.25 Letter to Isaiah (mailed).pdf'), '2026.8.25 Letter to Isaiah (mailed).pdf');
});

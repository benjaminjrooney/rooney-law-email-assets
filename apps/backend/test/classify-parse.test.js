import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/classify-parse.mjs', import.meta.url));
const ENV = { PATH: process.env.PATH, RETURN_ADDRESS_LINE1: '123 North LaSalle Street', RETURN_COMPANY: 'Rooney Law' };

function classify(text) {
  const r = spawnSync(process.execPath, [SCRIPT], { input: text, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'the script must not write anything else');
  return r.stdout;
}

test('prints "blank" when nothing is read', () => {
  assert.equal(classify('Dear Ms. Sample:\nHello.\n'), 'blank\n');
});

test('prints field shapes only: letters as a, digits as 9, never the words', () => {
  const out = classify(['VIA CERTIFIED MAIL', 'Dana Sample', 'Sample Holdings, LLC', '100 Example Avenue, Suite 200', 'Springfield, Illinois 62700', 'Dear Ms. Sample:'].join('\n'));
  assert.equal(out.split('\n').length, 2, 'one line');
  assert.match(out, /^candidate /);
  assert.match(out, /zip=99999/);
  assert.match(out, /state=aa/);
  const values = out.replace(/^candidate /, '').trim().split(' ').filter((t) => t.includes('=') && !t.startsWith('cc=')).map((t) => t.slice(t.indexOf('=') + 1));
  assert.ok(values.length >= 7);
  for (const v of values) assert.match(v, /^[a9\-.,&# ]*$/, `unmasked value: ${v}`);
  assert.doesNotMatch(out.replace(/^candidate|\b(name|company|line1|line2|city|state|zip|cc)=/g, '').replace(/ \d+\n$/, ''), /[b-zA-Z0-8]/);
  assert.match(out, / cc=\d+\n$/, 'the CC count is the only unmasked number');
});

test('a rejected candidate prints blank, not its shape', () => {
  const out = classify(['Dana Sample', '48217', 'Springfield, Illinois 62700', 'Dear Ms. Sample:'].join('\n'));
  assert.equal(out, 'blank\n');
});

#!/usr/bin/env node
/**
 * Counts-only measurement helper. Reads extracted letter text on stdin, runs
 * the real parser exactly as POST /api/parse does, and prints ONE line:
 *
 *   blank
 *   candidate name=aaaa aaaaaa company=- line1=999 aaaaaaa aaaaaaa line2=- city=aaaaaaaaaa state=aa zip=99999 cc=9
 *
 * Every letter is masked as "a" and every digit as "9"; nothing else about the
 * text is printed, and nothing is written to disk or to stderr. Letters in the
 * mask keep word lengths, which is the only thing that leaks. The firm's own
 * address is excluded from the environment (RETURN_ADDRESS_LINE1, RETURN_COMPANY
 * or RETURN_NAME), as the server does.
 *
 *   node apps/backend/scripts/classify-parse.mjs < extracted.txt
 */
import { parseForPlej } from '../src/parse.js';

const mask = (value) =>
  value === undefined ? '-' : String(value).replace(/\p{L}/gu, 'a').replace(/\d/g, '9').replace(/\s+/g, ' ');

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const text = Buffer.concat(chunks).toString('utf8');

const result = parseForPlej(text, {
  address_line1: process.env.RETURN_ADDRESS_LINE1,
  company: process.env.RETURN_COMPANY,
  name: process.env.RETURN_NAME,
});

const r = result.recipient;
if (!r) {
  console.log('blank');
} else {
  console.log(
    `candidate name=${mask(r.name)} company=${mask(r.company)} line1=${mask(r.line1)} line2=${mask(r.line2)} ` +
      `city=${mask(r.city)} state=${mask(r.state)} zip=${mask(r.zip)} cc=${result.cc.length}`,
  );
}

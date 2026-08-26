/**
 * Fill in the manifest template for a specific deployment.
 *
 *   npm run manifest -- --base-url https://rooney-mail.up.railway.app
 *
 * The add-in ID must stay the same for the life of the deployment — Word keys
 * sideloaded add-ins by it — so it is generated once and then reused from the
 * previously built manifest unless --id is passed explicitly.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(ROOT, 'manifest.template.xml');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_FILE = path.join(OUT_DIR, 'manifest.xml');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const [flag, inlineValue] = current.split('=');
    const key = flag.replace(/^--/, '');
    args[key] = inlineValue ?? argv[++i] ?? '';
  }
  return args;
}

function existingId() {
  if (!existsSync(OUT_FILE)) return null;
  const match = readFileSync(OUT_FILE, 'utf8').match(/<Id>([^<]+)<\/Id>/);
  return match ? match[1] : null;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args['base-url'] ?? process.env.ADDIN_BASE_URL ?? '').trim().replace(/\/+$/, '');

if (!baseUrl) {
  process.stderr.write(
    'Usage: npm run manifest -- --base-url https://your-app.up.railway.app [--id <guid>]\n',
  );
  process.exit(1);
}
if (!/^https:\/\//i.test(baseUrl)) {
  process.stderr.write('The base URL must start with https:// — Word refuses to load add-ins over http.\n');
  process.exit(1);
}

const addinId = args.id || existingId() || randomUUID();

const manifest = readFileSync(TEMPLATE, 'utf8')
  .replaceAll('{{BASE_URL}}', baseUrl)
  .replaceAll('{{ADDIN_ID}}', addinId);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, manifest);

process.stdout.write(`Wrote ${path.relative(process.cwd(), OUT_FILE)}\n`);
process.stdout.write(`  add-in id: ${addinId}\n`);
process.stdout.write(`  base URL:  ${baseUrl}\n`);
process.stdout.write('Sideload this file in Word (see docs/SETUP.md).\n');

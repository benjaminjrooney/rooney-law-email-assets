/**
 * End-to-end smoke test for the task pane.
 *
 * Runs the real HTML/CSS/JS against the real backend (with a stubbed Lob) in
 * headless Chromium, standing in for Word by injecting a minimal Office.js.
 * Skipped automatically when Playwright is not installed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../backend/src/app.js';
import { testConfig, startServer, samplePdf, FakeLob, TEST_TOKEN } from '../../backend/test/helpers.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  chromium = null;
}

/**
 * Launch the browser Playwright installed by default; CHROMIUM_PATH lets a
 * machine with a preinstalled Chromium (CI images, dev containers) point at it.
 *
 * @returns {Promise<import('playwright').Browser|null>} null when no browser is
 * available, so the suite skips instead of failing on a machine that never ran
 * `npx playwright install chromium`.
 */
async function launchBrowser() {
  const options = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  try {
    return await chromium.launch(options);
  } catch (error) {
    if (/Executable doesn't exist|playwright install/i.test(error.message)) return null;
    throw error;
  }
}

const SKIP_REASON = 'Chromium is not installed — run `npx playwright install chromium` or set CHROMIUM_PATH.';

const LETTER_TEXT = [
  'ROONEY LAW',
  '123 North LaSalle Street, Suite 1200',
  'Chicago, Illinois 60602',
  '',
  'August 25, 2026',
  '',
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
  'Demand is hereby made for payment in full within fourteen days.',
  '',
  'Sincerely,',
  'Benjamin J. Rooney',
  '',
  'cc: Robert Roe (via regular mail)',
  'Roe Law Group',
  '1 North Wacker Drive',
  'Chicago, IL 60606',
].join('\r');

/** Minimal Office.js stand-in, injected before the page's own scripts run. */
function officeStub(letterText, pdfBytes) {
  window.Office = {
    onReady: (callback) => Promise.resolve().then(() => callback({ host: 'Word', platform: 'PC' })),
    FileType: { Pdf: 'pdf', Text: 'text', Compressed: 'compressed' },
    AsyncResultStatus: { Succeeded: 'succeeded', Failed: 'failed' },
    PlatformType: { OfficeOnline: 'OfficeOnline', PC: 'PC' },
    context: {
      platform: 'PC',
      document: {
        url: 'C:\\Letters\\Smith demand letter.docx',
        getFileAsync: (fileType, options, callback) => {
          callback({
            status: 'succeeded',
            value: {
              sliceCount: 1,
              getSliceAsync: (index, sliceCallback) =>
                sliceCallback({ status: 'succeeded', value: { index, data: pdfBytes } }),
              closeAsync: (closeCallback) => closeCallback && closeCallback({ status: 'succeeded' }),
            },
          });
        },
      },
    },
  };

  window.Word = {
    run: async (callback) =>
      callback({
        document: { body: { load: () => {}, text: letterText } },
        sync: async () => {},
      }),
  };
}

test('task pane reads the letter, pre-fills it and sends it', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const lob = new FakeLob();
  const server = await startServer(createApp({ config: testConfig(), lobClient: lob }));

  try {
    const context = await browser.newContext();
    // office.js comes from Microsoft's CDN in the real add-in; the stub replaces it.
    await context.route('https://appsforoffice.microsoft.com/**', (route) => route.abort());

    const page = await context.newPage();
    const pdfBytes = [...samplePdf()];
    // Init scripts run in the order they are added: define the stub, then use it.
    await page.addInitScript(`window.officeStubImpl = ${officeStub.toString()};`);
    await page.addInitScript(
      ([letterText, bytes, token]) => {
        window.localStorage.setItem('rooneyLawMail.baseUrl', window.location.origin);
        window.localStorage.setItem('rooneyLawMail.token', token);
        window.officeStubImpl(letterText, bytes);
      },
      [LETTER_TEXT, pdfBytes, TEST_TOKEN],
    );

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${server.base}/addin/taskpane.html`);
    await page.waitForSelector('#letter-form:not([hidden])');

    // Auto-extraction filled the form from the document text.
    assert.equal(await page.inputValue('#mail-class'), 'certified_return_receipt');
    assert.equal(await page.inputValue('#to-name'), 'Jane Doe, Esq.');
    assert.equal(await page.inputValue('#to-company'), 'Doe & Associates LLC');
    assert.equal(await page.inputValue('#to-city'), 'Chicago');
    assert.equal(await page.inputValue('#to-zip'), '60661');
    assert.equal(await page.inputValue('#opt-description'), 'Re: Smith v. Jones, Case No. 2026 L 001234');

    // The CC block became a checked copy with its own mail class.
    assert.equal(await page.isChecked('#cc-0-enabled'), true);
    assert.equal(await page.inputValue('#cc-0-name'), 'Robert Roe');
    assert.equal(await page.inputValue('#cc-0-class'), 'regular');

    assert.match(await page.textContent('#summary'), /2 letters/);
    assert.match(await page.textContent('#mode-badge'), /test mode/);

    // First click confirms, second click sends.
    await page.click('#send');
    assert.match(await page.textContent('#send'), /Confirm/);
    await page.click('#send');

    await page.waitForSelector('#results:not([hidden])');
    const results = await page.textContent('#results-body');
    assert.match(results, /ltr_0/);
    assert.match(results, /Jane Doe/);
    assert.match(results, /Robert Roe/);

    assert.equal(lob.calls.length, 2);
    assert.equal(lob.calls[0].extraService, 'certified_return_receipt');
    assert.equal(lob.calls[1].extraService, null);
    assert.equal(lob.calls[0].file.filename, 'Smith demand letter.pdf');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('the task pane asks for settings when none are stored', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const server = await startServer(createApp({ config: testConfig(), lobClient: new FakeLob() }));

  try {
    const context = await browser.newContext();
    await context.route('https://appsforoffice.microsoft.com/**', (route) => route.abort());
    const page = await context.newPage();
    await page.addInitScript(`window.officeStubImpl = ${officeStub.toString()};`);
    await page.addInitScript(([letterText]) => window.officeStubImpl(letterText, []), [LETTER_TEXT]);

    await page.goto(`${server.base}/addin/taskpane.html`);
    await page.waitForSelector('#settings-panel:not([hidden])');
    assert.match(await page.textContent('#status'), /access token/i);
  } finally {
    await browser.close();
    await server.close();
  }
});

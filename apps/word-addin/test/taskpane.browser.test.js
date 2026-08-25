/**
 * End-to-end smoke tests for the task pane.
 *
 * Runs the real HTML/CSS/JS against the real backend (with a stubbed Lob) in
 * headless Chromium, standing in for Word by injecting a minimal Office.js.
 * Skipped automatically when Playwright is not installed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../backend/src/app.js';
import { EventStore } from '../../backend/src/event-store.js';
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

/**
 * Boot the service, open the task pane in a browser, and return everything the
 * test needs plus a close() that tears it all down.
 */
async function openTaskPane({ browser, lob = new FakeLob(), config = testConfig(), eventStore, withToken = true } = {}) {
  const server = await startServer(createApp({ config, lobClient: lob, eventStore }));
  const context = await browser.newContext();
  // office.js comes from Microsoft's CDN in the real add-in; the stub replaces it.
  await context.route('https://appsforoffice.microsoft.com/**', (route) => route.abort());

  const page = await context.newPage();
  await page.addInitScript(`window.officeStubImpl = ${officeStub.toString()};`);
  // Init scripts run in the order they are added: define the stub, then use it.
  await page.addInitScript(
    ([letterText, bytes, token]) => {
      if (token) {
        window.localStorage.setItem('rooneyLawMail.baseUrl', window.location.origin);
        window.localStorage.setItem('rooneyLawMail.token', token);
      }
      window.officeStubImpl(letterText, bytes);
    },
    [LETTER_TEXT, [...samplePdf()], withToken ? TEST_TOKEN : ''],
  );

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${server.base}/addin/taskpane.html`);

  return {
    page,
    server,
    lob,
    errors,
    async close() {
      await context.close();
      await server.close();
    },
  };
}

/** Two clicks: the first asks for confirmation, the second actually sends. */
async function sendLetter(page) {
  await page.click('#send');
  await page.click('#send');
  await page.waitForSelector('#results:not([hidden])');
}

test('task pane reads the letter, pre-fills it and sends it', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const pane = await openTaskPane({ browser });
  const { page, lob, errors } = pane;

  try {
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
    await pane.close();
    await browser.close();
  }
});

test('the task pane asks for settings when none are stored', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const pane = await openTaskPane({ browser, withToken: false });
  try {
    await pane.page.waitForSelector('#settings-panel:not([hidden])');
    assert.match(await pane.page.textContent('#status'), /access token/i);
  } finally {
    await pane.close();
    await browser.close();
  }
});

test('a sent letter can be canceled within the window', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const sendDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const lob = new FakeLob({
    respond: (letter, index) => ({ id: `ltr_${index}`, send_date: sendDate, to: letter.to }),
  });
  const pane = await openTaskPane({ browser, lob });
  const { page } = pane;

  try {
    await page.waitForSelector('#letter-form:not([hidden])');
    await sendLetter(page);

    // The countdown comes from the letter's send_date, not a hard-coded guess.
    assert.match(await page.textContent('#results-body'), /Can be pulled back for another \d+m \d\ds/);

    await page.click('#results-body .cancel-controls button');
    await page.waitForSelector('#results-body .message-ok');
    assert.match(await page.textContent('#results-body .message-ok'), /will not be printed or charged/);
    assert.deepEqual(pane.lob.canceled, ['ltr_0']);
    assert.deepEqual(pane.errors, []);
  } finally {
    await pane.close();
    await browser.close();
  }
});

test('the cancel button is closed off once the window has passed', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const sendDate = new Date(Date.now() - 60 * 1000).toISOString();
  const lob = new FakeLob({
    respond: (letter, index) => ({ id: `ltr_${index}`, send_date: sendDate, to: letter.to }),
  });
  const pane = await openTaskPane({ browser, lob });

  try {
    await pane.page.waitForSelector('#letter-form:not([hidden])');
    await sendLetter(pane.page);

    assert.match(await pane.page.textContent('#results-body'), /cancellation window has closed/);
    assert.equal(await pane.page.isDisabled('#results-body .cancel-controls button'), true);
  } finally {
    await pane.close();
    await browser.close();
  }
});

test('an address can be checked and the USPS version applied', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const pane = await openTaskPane({ browser, lob: new FakeLob({ isLive: true }) });
  const { page } = pane;

  try {
    await page.waitForSelector('#letter-form:not([hidden])');
    assert.match(await page.textContent('#mode-badge'), /live postage/);

    await page.click('#check-to');
    await page.waitForSelector('#to-verify .message');
    assert.match(await page.textContent('#to-verify'), /USPS can deliver/);

    // USPS shortened the street line, so the pane offers the change rather than
    // silently rewriting what was typed.
    assert.match(await page.textContent('#to-verify .suggestion'), /500 W Madison St/);
    assert.equal(await page.inputValue('#to-line1'), '500 West Madison Street, Suite 1000');

    await page.click('#to-verify .suggestion button');
    assert.equal(await page.inputValue('#to-line1'), '500 W Madison St');
    assert.equal(await page.inputValue('#to-line2'), 'Ste 1000');
    assert.equal(await page.inputValue('#to-zip'), '60661-2511');
    assert.deepEqual(pane.errors, []);
  } finally {
    await pane.close();
    await browser.close();
  }
});

test('on a test key the address check says why it cannot run', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const pane = await openTaskPane({ browser });
  try {
    await pane.page.waitForSelector('#letter-form:not([hidden])');
    assert.match(await pane.page.textContent('#check-to'), /needs a live Lob key/);
    assert.equal(await pane.page.isDisabled('#check-to'), true);
    assert.equal(await pane.page.isDisabled('#cc-0-enabled'), false, 'the rest of the pane still works');
  } finally {
    await pane.close();
    await browser.close();
  }
});

test('recent mail shows the latest tracking event for each letter', { skip: chromium ? false : 'playwright not installed' }, async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip(SKIP_REASON);

  const eventStore = new EventStore({});
  await eventStore.record({
    reference_id: 'ltr_0',
    event_type: { id: 'letter.certified.delivered' },
    body: { id: 'ltr_0', tracking_number: '9407123', to: { name: 'Jane Doe' } },
  });

  const config = testConfig({ env: { LOB_WEBHOOK_SECRET: 'whsec_test' } });
  const pane = await openTaskPane({ browser, config, eventStore });

  try {
    await pane.page.waitForSelector('#letter-form:not([hidden])');
    await pane.page.click('#recent-mail summary');
    await pane.page.waitForSelector('#recent-body .result-item');

    const text = await pane.page.textContent('#recent-body');
    assert.match(text, /Certified: delivered/);
    assert.match(text, /9407123/);
    assert.match(text, /No tracking event yet/, 'letters without events are still listed');
    assert.deepEqual(pane.errors, []);
  } finally {
    await pane.close();
    await browser.close();
  }
});

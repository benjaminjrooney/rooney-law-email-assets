/**
 * Task pane controller: read the open letter, confirm the details, mail it.
 */

import { parseLetter } from './parse-letter.js';
import { ApiClient, ApiError } from './api.js';
import { loadSettings, saveSettings, hasSettings } from './settings.js';
import {
  officeReady,
  exportDocumentPdf,
  readDocumentText,
  documentPdfName,
  isWordOnTheWeb,
  ExportError,
} from './office-export.js';

const el = (id) => document.getElementById(id);

const state = {
  client: null,
  config: null,
  parsed: null,
  ccRows: [],
  /** Reused across retries so a failed send can never mail the same letter twice. */
  idempotencyKey: null,
  awaitingConfirm: false,
  busy: false,
  /** Countdown timers for the cancellation windows shown on the results card. */
  timers: [],
  /** The exact PDF that was mailed, kept so a copy can be saved. */
  mailedPdf: null,
};

function clearTimers() {
  for (const timer of state.timers) clearInterval(timer);
  state.timers = [];
}

// ---------------------------------------------------------------- messages --

function clearStatus() {
  el('status').replaceChildren();
}

function showMessage(kind, text, { items = [], spinner = false, replace = false } = {}) {
  const status = el('status');
  if (replace) status.replaceChildren();

  const box = document.createElement('div');
  box.className = `message message-${kind}`;

  const line = document.createElement('div');
  if (spinner) {
    const dot = document.createElement('span');
    dot.className = 'spinner';
    line.append(dot);
  }
  line.append(document.createTextNode(text));
  box.append(line);

  if (items.length > 0) {
    const list = document.createElement('ul');
    for (const item of items) {
      const entry = document.createElement('li');
      entry.textContent = item;
      list.append(entry);
    }
    box.append(list);
  }

  status.append(box);
  return box;
}

// ---------------------------------------------------------------- settings --

function showSettingsPanel(show) {
  el('settings-panel').hidden = !show;
  el('letter-form').hidden = show;
  el('cancel-settings').hidden = !state.config;
}

async function connect() {
  const settings = loadSettings();
  el('setting-base-url').value = settings.baseUrl;
  el('setting-token').value = settings.token;

  if (!hasSettings(settings)) {
    showSettingsPanel(true);
    showMessage('info', 'Enter the mail service address and access token to get started.', { replace: true });
    return;
  }

  state.client = new ApiClient(settings);
  showMessage('info', 'Connecting to the mail service…', { spinner: true, replace: true });

  try {
    state.config = await state.client.getConfig();
  } catch (error) {
    if (error instanceof ApiError && error.isAuth) {
      showSettingsPanel(true);
      showMessage('error', 'That access token was rejected. Check it and save again.', { replace: true });
    } else {
      showSettingsPanel(true);
      showMessage('error', error.message, { replace: true });
    }
    return;
  }

  applyConfig(state.config);
  showSettingsPanel(false);
  await readDocument();
}

function applyConfig(config) {
  const badge = el('mode-badge');
  const live = config.lobMode === 'live';
  badge.textContent = live ? 'live postage' : 'test mode';
  badge.className = `badge ${live ? 'badge-live' : 'badge-test'}`;

  const select = el('mail-class');
  select.replaceChildren();
  for (const mailClass of config.mailClasses) {
    const option = document.createElement('option');
    option.value = mailClass.id;
    option.textContent = mailClass.label;
    select.append(option);
  }

  configureCheckButton(el('check-to'));

  el('opt-color').checked = Boolean(config.defaults.color);
  el('opt-double-sided').checked = Boolean(config.defaults.doubleSided);
  el('opt-placement').value = config.defaults.addressPlacement;

  const ret = config.returnAddress;
  el('return-address').textContent = [
    ret.name,
    ret.company,
    ret.address_line1,
    ret.address_line2,
    [ret.address_city, ret.address_state].filter(Boolean).join(', ') +
      (ret.address_zip ? ` ${ret.address_zip}` : ''),
  ]
    .filter((line) => line && line.trim())
    .join('\n');
}

// -------------------------------------------------------- document reading --

function fillRecipient(recipient) {
  el('to-name').value = recipient?.name ?? '';
  el('to-company').value = recipient?.company ?? '';
  el('to-line1').value = recipient?.address_line1 ?? '';
  el('to-line2').value = recipient?.address_line2 ?? '';
  el('to-city').value = recipient?.address_city ?? '';
  el('to-state').value = recipient?.address_state ?? '';
  el('to-zip').value = recipient?.address_zip ?? '';
}

// -------------------------------------------------------- address checking --

const DELIVERABILITY_TONE = {
  deliverable: 'ok',
  deliverable_unnecessary_unit: 'ok',
  deliverable_incorrect_unit: 'warn',
  deliverable_missing_unit: 'warn',
  undeliverable: 'error',
};

const STANDARDIZED_FIELDS = [
  ['address_line1', 'line1'],
  ['address_line2', 'line2'],
  ['address_city', 'city'],
  ['address_state', 'state'],
  ['address_zip', 'zip'],
];

function sameAddress(standardized, current) {
  return STANDARDIZED_FIELDS.every(
    ([field]) =>
      (standardized[field] ?? '').trim().toLowerCase() === (current[field] ?? '').trim().toLowerCase(),
  );
}

function applyStandardized(prefix, standardized) {
  for (const [field, suffix] of STANDARDIZED_FIELDS) {
    const input = el(`${prefix}${suffix}`);
    if (input) input.value = standardized[field] ?? '';
  }
}

function renderVerification(result, container, prefix) {
  container.replaceChildren();

  const tone = result.usable ? DELIVERABILITY_TONE[result.deliverability] ?? 'info' : 'info';
  const box = document.createElement('div');
  box.className = `message message-${tone}`;
  box.append(document.createTextNode(result.message));
  container.append(box);

  if (!result.usable || !result.standardized) return;

  const current = readAddressFields(prefix);
  if (sameAddress(result.standardized, current)) return;

  // USPS rewrote something. Show what it would become rather than silently
  // changing what the user typed.
  const suggestion = document.createElement('div');
  suggestion.className = 'suggestion';
  const lines = [
    result.standardized.address_line1,
    result.standardized.address_line2,
    `${result.standardized.address_city}, ${result.standardized.address_state} ${result.standardized.address_zip}`,
  ].filter(Boolean);
  const text = document.createElement('p');
  text.className = 'return-address';
  text.textContent = `USPS has it as:\n${lines.join('\n')}`;
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'ghost';
  apply.textContent = 'Use the USPS version';
  apply.addEventListener('click', () => {
    applyStandardized(prefix, result.standardized);
    suggestion.replaceChildren();
    const applied = document.createElement('p');
    applied.className = 'hint';
    applied.textContent = 'Address updated.';
    suggestion.append(applied);
  });
  suggestion.append(text, apply);
  container.append(suggestion);
}

/**
 * Address checking only returns real answers on a live Lob key, so on a test
 * key the control stays visible but says why it cannot run.
 */
function configureCheckButton(button) {
  const available = Boolean(state.config?.features?.addressCheck);
  button.disabled = !available;
  button.textContent = available ? 'Check this address with USPS' : 'Address check needs a live Lob key';
  return button;
}

async function checkAddress({ prefix, container, button }) {
  container.replaceChildren();
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Checking…';

  try {
    const result = await state.client.verifyAddress(readAddressFields(prefix));
    renderVerification(result, container, prefix);
  } catch (error) {
    const box = document.createElement('div');
    box.className = 'message message-error';
    box.textContent =
      error instanceof ApiError ? error.message : `Could not check the address: ${error?.message ?? error}`;
    container.replaceChildren(box);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function ccFieldId(index, field) {
  return `cc-${index}-${field}`;
}

function renderCcList(entries) {
  const list = el('cc-list');
  list.replaceChildren();
  state.ccRows = [];

  el('cc-section').hidden = entries.length === 0;

  entries.forEach((entry, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'cc-entry';
    const mailable = entry.confidence !== 'none';
    wrapper.dataset.enabled = String(mailable);

    const header = document.createElement('header');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = ccFieldId(index, 'enabled');
    toggle.checked = mailable;
    const toggleLabel = document.createElement('label');
    toggleLabel.htmlFor = toggle.id;
    toggleLabel.textContent = `Mail a copy to ${entry.name || entry.company || `CC ${index + 1}`}`;
    header.append(toggle, toggleLabel);
    wrapper.append(header);

    const fields = document.createElement('div');
    fields.className = 'cc-fields';

    const addField = (field, labelText, value, { maxLength } = {}) => {
      const label = document.createElement('label');
      label.htmlFor = ccFieldId(index, field);
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = ccFieldId(index, field);
      input.value = value ?? '';
      if (maxLength) input.maxLength = maxLength;
      fields.append(label, input);
    };

    addField('name', 'Name', entry.name, { maxLength: 40 });
    addField('company', 'Company', entry.company, { maxLength: 40 });
    addField('line1', 'Street address', entry.address_line1);
    addField('line2', 'Suite / floor', entry.address_line2);

    const row = document.createElement('div');
    row.className = 'row';
    const cityWrap = document.createElement('div');
    cityWrap.className = 'grow';
    const cityLabel = document.createElement('label');
    cityLabel.htmlFor = ccFieldId(index, 'city');
    cityLabel.textContent = 'City';
    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.id = ccFieldId(index, 'city');
    cityInput.value = entry.address_city ?? '';
    cityWrap.append(cityLabel, cityInput);

    const stateWrap = document.createElement('div');
    stateWrap.className = 'narrow';
    const stateLabel = document.createElement('label');
    stateLabel.htmlFor = ccFieldId(index, 'state');
    stateLabel.textContent = 'State';
    const stateInput = document.createElement('input');
    stateInput.type = 'text';
    stateInput.maxLength = 2;
    stateInput.id = ccFieldId(index, 'state');
    stateInput.value = entry.address_state ?? '';
    stateWrap.append(stateLabel, stateInput);

    const zipWrap = document.createElement('div');
    zipWrap.className = 'narrow';
    const zipLabel = document.createElement('label');
    zipLabel.htmlFor = ccFieldId(index, 'zip');
    zipLabel.textContent = 'ZIP';
    const zipInput = document.createElement('input');
    zipInput.type = 'text';
    zipInput.maxLength = 10;
    zipInput.id = ccFieldId(index, 'zip');
    zipInput.value = entry.address_zip ?? '';
    zipWrap.append(zipLabel, zipInput);

    row.append(cityWrap, stateWrap, zipWrap);
    fields.append(row);

    const classLabel = document.createElement('label');
    classLabel.htmlFor = ccFieldId(index, 'class');
    classLabel.textContent = 'How this copy goes out';
    const classSelect = document.createElement('select');
    classSelect.id = ccFieldId(index, 'class');
    for (const mailClass of state.config.mailClasses) {
      const option = document.createElement('option');
      option.value = mailClass.id;
      option.textContent = mailClass.label;
      classSelect.append(option);
    }
    classSelect.value = entry.mailClass;
    fields.append(classLabel, classSelect);

    if (entry.otherMethods?.length > 0) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = `The letter also names ${entry.otherMethods.join(', ')} for this copy — send that separately.`;
      fields.append(note);
    }

    const actions = document.createElement('div');
    actions.className = 'field-actions';
    const checkButton = configureCheckButton(document.createElement('button'));
    checkButton.type = 'button';
    checkButton.className = 'link';
    const verifyBox = document.createElement('div');
    verifyBox.className = 'verify-result';
    checkButton.addEventListener('click', () =>
      checkAddress({ prefix: `cc-${index}-`, container: verifyBox, button: checkButton }),
    );
    actions.append(checkButton);
    fields.append(actions, verifyBox);

    wrapper.append(fields);
    list.append(wrapper);

    toggle.addEventListener('change', () => {
      wrapper.dataset.enabled = String(toggle.checked);
      updateSummary();
    });
    classSelect.addEventListener('change', updateSummary);

    state.ccRows.push({ index, toggle, classSelect });
  });
}

async function readDocument() {
  clearStatus();
  clearTimers();
  el('to-verify').replaceChildren();
  const reading = showMessage('info', 'Reading the letter…', { spinner: true });

  let text;
  try {
    text = await readDocumentText();
  } catch (error) {
    reading.remove();
    showMessage('error', `Could not read the document: ${error.message}`);
    el('letter-form').hidden = false;
    return;
  }

  const ret = state.config?.returnAddress ?? {};
  state.parsed = parseLetter(text, {
    excludeZip: ret.address_zip,
    excludeCompany: ret.company || ret.name,
  });

  fillRecipient(state.parsed.recipient);
  el('mail-class').value = state.parsed.mailClass;
  el('opt-description').value = state.parsed.subject ? `Re: ${state.parsed.subject}`.slice(0, 200) : '';
  renderCcList(state.parsed.cc);

  el('delivery-source').textContent = state.parsed.deliveryDetected
    ? `Read from the letter: "${state.parsed.deliveryLine}"`
    : 'No mail class found in the letter — defaulting to regular mail.';

  reading.remove();

  if (state.parsed.otherMethods.length > 0) {
    showMessage(
      'warn',
      `The letter also names ${state.parsed.otherMethods.join(', ')} for the recipient. Only the physical mailing happens here.`,
    );
  }
  for (const warning of state.parsed.warnings) {
    showMessage('warn', warning);
  }

  if (isWordOnTheWeb()) {
    showMessage(
      'warn',
      'Word on the web cannot export a PDF from an add-in. Open this document in the Word desktop app to send it.',
    );
  }

  el('letter-form').hidden = false;
  el('results').hidden = true;
  resetConfirm();
  updateSummary();
}

// -------------------------------------------------------------- form model --

function readAddressFields(prefix) {
  const value = (field) => el(`${prefix}${field}`).value.trim();
  return {
    name: value('name'),
    company: value('company'),
    address_line1: value('line1'),
    address_line2: value('line2'),
    address_city: value('city'),
    address_state: value('state').toUpperCase(),
    address_zip: value('zip'),
  };
}

function selectedCcEntries() {
  return state.ccRows
    .filter((row) => row.toggle.checked)
    .map((row) => ({
      ...readAddressFields(`cc-${row.index}-`),
      mailClass: row.classSelect.value,
    }));
}

function buildPayload() {
  return {
    to: readAddressFields('to-'),
    cc: selectedCcEntries(),
    mailClass: el('mail-class').value,
    options: {
      color: el('opt-color').checked,
      doubleSided: el('opt-double-sided').checked,
      addressPlacement: el('opt-placement').value,
      description: el('opt-description').value.trim(),
    },
    metadata: {
      source: 'word-addin',
      ...(state.parsed?.subject ? { subject: state.parsed.subject.slice(0, 200) } : {}),
    },
    idempotencyKey: state.idempotencyKey,
  };
}

const REQUIRED_FIELDS = [
  ['line1', 'street address'],
  ['city', 'city'],
  ['state', 'state'],
  ['zip', 'ZIP code'],
];

function validateAddressFields(prefix, label) {
  const problems = [];
  const nameField = el(`${prefix}name`);
  const companyField = el(`${prefix}company`);
  const hasWho = nameField.value.trim() || companyField.value.trim();
  nameField.setAttribute('aria-invalid', String(!hasWho));
  if (!hasWho) problems.push(`${label}: enter a name or a company.`);

  for (const [field, description] of REQUIRED_FIELDS) {
    const input = el(`${prefix}${field}`);
    const empty = !input.value.trim();
    input.setAttribute('aria-invalid', String(empty));
    if (empty) problems.push(`${label}: enter the ${description}.`);
  }

  const zip = el(`${prefix}zip`).value.trim();
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) {
    el(`${prefix}zip`).setAttribute('aria-invalid', 'true');
    problems.push(`${label}: the ZIP code should look like 60601 or 60601-1234.`);
  }
  const stateValue = el(`${prefix}state`).value.trim();
  if (stateValue && !/^[A-Za-z]{2}$/.test(stateValue)) {
    el(`${prefix}state`).setAttribute('aria-invalid', 'true');
    problems.push(`${label}: use the two-letter state abbreviation.`);
  }
  return problems;
}

function validate() {
  const problems = validateAddressFields('to-', 'Recipient');
  for (const row of state.ccRows) {
    if (!row.toggle.checked) continue;
    problems.push(...validateAddressFields(`cc-${row.index}-`, `Copy ${row.index + 1}`));
  }
  return problems;
}

function mailClassLabel(id) {
  return state.config?.mailClasses.find((entry) => entry.id === id)?.label ?? id;
}

function updateSummary() {
  const copies = state.ccRows.filter((row) => row.toggle.checked).length;
  const total = 1 + copies;
  const live = state.config?.lobMode === 'live';
  const parts = [mailClassLabel(el('mail-class').value)];
  if (copies > 0) parts.push(`${copies} ${copies === 1 ? 'copy' : 'copies'}`);
  parts.push(live ? 'real postage will be charged' : 'test mode — nothing is mailed');

  const count = document.createElement('strong');
  count.textContent = `${total} ${total === 1 ? 'letter' : 'letters'}`;
  el('summary').replaceChildren(count, document.createTextNode(` · ${parts.join(' · ')}`));
  resetConfirm();
}

function resetConfirm() {
  if (state.busy) return;
  state.awaitingConfirm = false;
  el('send').textContent = 'Send letter';
}

// --------------------------------------------------------------- confirm --

function formatMoney(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return null;
  return currency === 'USD' ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`;
}

/**
 * Price the send before asking for confirmation.
 *
 * Lob does not return a price when a letter is created, so the cost is worked
 * out on the server from the firm's configured rates. That needs the page
 * count, which needs the PDF — so the document is exported here and again at
 * send time, keeping the mailed PDF current if the document changes in between.
 */
async function askForConfirmation(letterCount) {
  const live = state.config?.lobMode === 'live';
  el('send').disabled = true;
  el('send').textContent = 'Checking…';

  const progress = showMessage('info', 'Exporting the document to price the send…', {
    spinner: true,
    replace: true,
  });

  let quote = null;
  try {
    const { blob } = await exportDocumentPdf();
    quote = await state.client.estimate({
      pdf: blob,
      filename: documentPdfName(),
      payload: buildPayload(),
    });
  } catch (error) {
    progress.remove();
    el('send').disabled = false;
    if (error instanceof ExportError) {
      // If the document cannot be exported now it cannot be mailed either.
      reportSendError(error);
      resetConfirm();
      return;
    }
    if (error instanceof ApiError && error.isAuth) {
      reportSendError(error);
      resetConfirm();
      return;
    }
    // Anything else is only a pricing failure: say so and let the send proceed.
    showMessage('warn', `Could not price this send: ${error?.message ?? error}`, { replace: true });
  }

  progress.remove();
  el('send').disabled = false;
  state.awaitingConfirm = true;

  const costLabel = quote?.total?.available ? formatMoney(quote.total.total, quote.total.currency) : null;
  const noun = letterCount === 1 ? 'letter' : 'letters';
  el('send').textContent = live
    ? `Confirm — mail ${letterCount} ${noun}${costLabel ? ` (${costLabel})` : ''}`
    : `Confirm — create ${letterCount} test ${noun}`;

  const items = [];
  if (quote?.pages) {
    items.push(`${quote.pages} page${quote.pages === 1 ? '' : 's'} exported from this document.`);
  }
  for (const mailing of quote?.mailings ?? []) {
    const each = mailing.estimate?.available
      ? formatMoney(mailing.estimate.total, mailing.estimate.currency)
      : 'cost unknown';
    const role = mailing.role === 'cc' ? 'Copy' : 'Recipient';
    items.push(`${role} — ${mailing.recipient}: ${each}`);
  }
  if (quote && !quote.total?.available) {
    const note = quote.mailings?.find((mailing) => mailing.estimate?.notes?.length > 0)?.estimate.notes[0];
    if (note) items.push(note);
  }

  showMessage(
    live ? 'warn' : 'info',
    live
      ? `This will print and mail ${letterCount} ${noun} through Lob${costLabel ? `, about ${costLabel} in postage` : ''}. Charged to the firm account.`
      : 'The service is in test mode: Lob will create the letters but nothing is printed or mailed.',
    { items, replace: true },
  );

  if (costLabel) {
    showMessage('info', 'The cost is an estimate from the configured rates — reconcile against the Lob invoice.');
  }
}

// ------------------------------------------------------------------- send --

async function handleSubmit(event) {
  event.preventDefault();
  if (state.busy) return;

  const problems = validate();
  if (problems.length > 0) {
    showMessage('error', 'Fix these before sending:', { items: problems, replace: true });
    state.awaitingConfirm = false;
    el('send').textContent = 'Send letter';
    return;
  }

  const total = 1 + state.ccRows.filter((row) => row.toggle.checked).length;
  if (!state.awaitingConfirm) {
    await askForConfirmation(total);
    return;
  }

  state.busy = true;
  state.awaitingConfirm = false;
  el('send').disabled = true;
  el('send').textContent = 'Sending…';
  state.idempotencyKey = state.idempotencyKey ?? crypto.randomUUID();

  const progress = showMessage('info', 'Exporting the document as a PDF…', { spinner: true, replace: true });

  try {
    const { blob, byteLength } = await exportDocumentPdf();
    const filename = documentPdfName();
    progress.remove();
    const sending = showMessage(
      'info',
      `Sending ${(byteLength / 1024).toFixed(0)} KB to the mail service…`,
      { spinner: true },
    );

    const response = await state.client.createLetters({
      pdf: blob,
      filename,
      payload: buildPayload(),
    });

    sending.remove();
    state.idempotencyKey = null; // a fresh key for the next letter
    // Keep the exact bytes that were mailed, so a copy can be saved.
    state.mailedPdf = { blob, filename };
    renderResults(response);
  } catch (error) {
    progress.remove();
    reportSendError(error);
  } finally {
    state.busy = false;
    el('send').disabled = false;
    el('send').textContent = 'Send letter';
  }
}

function reportSendError(error) {
  if (error instanceof ExportError) {
    showMessage('error', error.message, { items: error.hint ? [error.hint] : [], replace: true });
    return;
  }
  if (error instanceof ApiError) {
    if (error.isAuth) {
      showSettingsPanel(true);
      showMessage('error', 'The mail service rejected the access token. Enter it again.', { replace: true });
      return;
    }
    showMessage('error', error.message, { items: error.details ?? [], replace: true });
    showMessage(
      'info',
      'Nothing was mailed. Fix the problem above and press Send again — the retry cannot duplicate a letter.',
    );
    return;
  }
  showMessage('error', error?.message ?? 'Something went wrong while sending.', { replace: true });
}

// --------------------------------------------------------- cancel a letter --

/**
 * Lob accepts a cancellation until the letter's send_date — five minutes after
 * creation on a default account. The countdown is driven by that date rather
 * than a guess, so it stays right if the firm's window is ever changed.
 */
function cancellationDeadline(letter) {
  if (letter.sendDate) {
    const deadline = Date.parse(letter.sendDate);
    if (Number.isFinite(deadline)) return deadline;
  }
  const created = letter.dateCreated ? Date.parse(letter.dateCreated) : Date.now();
  const minutes = state.config?.features?.cancellationWindowMinutes ?? 5;
  return (Number.isFinite(created) ? created : Date.now()) + minutes * 60 * 1000;
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

function buildCancelControls(letter) {
  const wrapper = document.createElement('div');
  wrapper.className = 'cancel-controls';
  if (!letter.id) return wrapper;

  const deadline = cancellationDeadline(letter);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost';
  button.textContent = 'Cancel this letter';

  const note = document.createElement('p');
  note.className = 'hint';

  const refresh = () => {
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      note.textContent = `Can be pulled back for another ${formatRemaining(remaining)}.`;
      return true;
    }
    button.disabled = true;
    note.textContent = 'The cancellation window has closed — this letter is going to print.';
    return false;
  };

  if (refresh()) {
    const timer = setInterval(() => {
      if (!refresh()) clearInterval(timer);
    }, 1000);
    state.timers.push(timer);
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Canceling…';
    try {
      await state.client.cancelLetter(letter.id);
      wrapper.replaceChildren();
      const done = document.createElement('p');
      done.className = 'message message-ok';
      done.textContent = 'Canceled. This letter will not be printed or charged.';
      wrapper.append(done);
    } catch (error) {
      button.textContent = 'Cancel this letter';
      button.disabled = false;
      note.textContent =
        error instanceof ApiError ? error.message : `Could not cancel: ${error?.message ?? error}`;
      note.className = 'message message-error';
    }
  });

  wrapper.append(button, note);
  return wrapper;
}

// ------------------------------------------------------------ recent mail --

function renderMailings(response) {
  const body = el('recent-body');
  body.replaceChildren();

  const mailings = response.mailings ?? [];
  if (mailings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No letters yet.';
    body.append(empty);
    return;
  }

  for (const mailing of mailings) {
    const item = document.createElement('div');
    item.className = 'result-item';

    const heading = document.createElement('strong');
    heading.textContent = mailing.to?.name || mailing.to?.company || mailing.id;
    item.append(heading);

    const list = document.createElement('dl');
    const addRow = (term, value) => {
      if (!value) return;
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      list.append(dt, dd);
    };
    addRow('Status', mailing.lastEvent ? mailing.lastEvent.label : 'No tracking event yet');
    addRow('Tracking', mailing.trackingNumber);
    addRow('Expected', mailing.expectedDeliveryDate);
    addRow('Reference', mailing.description);
    item.append(list);
    body.append(item);
  }

  if (!response.trackingConfigured) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent =
      'Delivery tracking is not switched on: set LOB_WEBHOOK_SECRET on the service and add the webhook in Lob.';
    body.append(note);
  }
}

async function loadMailings() {
  const body = el('recent-body');
  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = 'Loading…';
  body.replaceChildren(loading);

  try {
    renderMailings(await state.client.getMailings(10));
  } catch (error) {
    const failed = document.createElement('p');
    failed.className = 'message message-error';
    failed.textContent =
      error instanceof ApiError ? error.message : `Could not load recent mail: ${error?.message ?? error}`;
    body.replaceChildren(failed);
  }
}

/**
 * Offer the mailed PDF as a download, named after the document it came from.
 *
 * A stopgap: it lands wherever the browser puts downloads, so the copy still
 * has to be filed by hand. Saving straight into the matter folder needs
 * Microsoft Graph, which is the next piece of work.
 */
function buildSaveCopyControls() {
  const wrapper = document.createElement('div');
  wrapper.className = 'cancel-controls';
  if (!state.mailedPdf) return wrapper;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost';
  button.textContent = 'Save a copy of the mailed PDF';

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = state.mailedPdf.filename;

  button.addEventListener('click', () => {
    const url = URL.createObjectURL(state.mailedPdf.blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = state.mailedPdf.filename;
      document.body.append(link);
      link.click();
      link.remove();
      note.textContent = `Saved as ${state.mailedPdf.filename} — check your Downloads folder.`;
    } catch (error) {
      note.className = 'message message-error';
      note.textContent = `Word blocked the download: ${error?.message ?? error}. Use "View the printed proof" above and save from there.`;
    } finally {
      // Give the download a moment to start before releasing the blob.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  });

  wrapper.append(button, note);
  return wrapper;
}

function renderResults(response) {
  clearStatus();
  clearTimers();
  const body = el('results-body');
  body.replaceChildren();

  for (const mailing of response.mailings ?? []) {
    const item = document.createElement('div');
    item.className = `result-item${mailing.ok ? '' : ' failed'}`;

    const heading = document.createElement('strong');
    const role = mailing.role === 'cc' ? 'Copy' : 'Recipient';
    heading.textContent = mailing.ok
      ? `${role}: ${mailing.letter.to?.name || mailing.letter.to?.company || 'sent'}`
      : `${role}: not sent`;
    item.append(heading);

    const list = document.createElement('dl');
    const addRow = (term, value) => {
      if (!value) return;
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      list.append(dt, dd);
    };

    if (mailing.ok) {
      addRow('Class', mailClassLabel(mailing.mailClass));
      addRow('Lob ID', mailing.letter.id);
      addRow('Tracking', mailing.letter.trackingNumber);
      addRow('Expected', mailing.letter.expectedDeliveryDate);
      item.append(list);

      if (mailing.letter.url) {
        const link = document.createElement('a');
        link.href = mailing.letter.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'View the printed proof (PDF)';
        link.addEventListener('click', (event) => {
          // Desktop Word blocks plain target=_blank; route through Office when it can.
          if (Office.context?.ui?.openBrowserWindow) {
            event.preventDefault();
            Office.context.ui.openBrowserWindow(mailing.letter.url);
          }
        });
        item.append(link);
      }

      item.append(buildCancelControls(mailing.letter));
    } else {
      addRow('Class', mailClassLabel(mailing.mailClass));
      addRow('Recipient', mailing.recipient);
      addRow('Problem', mailing.error?.message);
      item.append(list);
    }

    body.append(item);
  }

  if (response.mailings?.some((mailing) => mailing.ok)) {
    body.append(buildSaveCopyControls());
  }

  el('letter-form').hidden = true;
  el('results').hidden = false;

  if (response.ok) {
    showMessage(
      response.mode === 'live' ? 'ok' : 'info',
      response.mode === 'live'
        ? 'Mailed. Lob has the letter in its print queue.'
        : 'Test letters created. Switch the service to a live Lob key to mail for real.',
      { replace: true },
    );
  } else {
    showMessage('warn', 'The main letter went out, but at least one copy failed. See below.', { replace: true });
  }
}

// ------------------------------------------------------------------- init --

function wireEvents() {
  el('letter-form').addEventListener('submit', handleSubmit);
  el('reread').addEventListener('click', () => {
    state.idempotencyKey = null;
    readDocument();
  });
  el('mail-class').addEventListener('change', updateSummary);
  el('open-settings').addEventListener('click', () => showSettingsPanel(true));
  el('cancel-settings').addEventListener('click', () => showSettingsPanel(false));
  el('start-over').addEventListener('click', () => {
    el('results').hidden = true;
    clearTimers();
    state.idempotencyKey = null;
    readDocument();
  });

  el('check-to').addEventListener('click', () =>
    checkAddress({ prefix: 'to-', container: el('to-verify'), button: el('check-to') }),
  );

  // Recent mail is a Lob round-trip, so it loads when the section is opened
  // rather than on every task pane launch.
  el('recent-mail').addEventListener('toggle', () => {
    if (el('recent-mail').open) loadMailings();
  });
  el('refresh-recent').addEventListener('click', loadMailings);

  for (const id of ['to-name', 'to-company', 'to-line1', 'to-line2', 'to-city', 'to-state', 'to-zip']) {
    el(id).addEventListener('input', () => el(id).setAttribute('aria-invalid', 'false'));
  }

  el('save-settings').addEventListener('click', async () => {
    const baseUrl = el('setting-base-url').value.trim();
    const token = el('setting-token').value.trim();
    if (!baseUrl || !token) {
      showMessage('error', 'Both the service address and the token are required.', { replace: true });
      return;
    }
    if (!/^https:\/\//i.test(baseUrl)) {
      showMessage('error', 'The service address must start with https://', { replace: true });
      return;
    }
    if (!saveSettings({ baseUrl, token })) {
      showMessage('error', 'This computer blocked local storage, so the settings could not be saved.', {
        replace: true,
      });
      return;
    }
    await connect();
  });
}

async function main() {
  await officeReady();
  el('app').hidden = false;
  wireEvents();
  await connect();
}

main().catch((error) => {
  const app = el('app');
  if (app) app.hidden = false;
  showMessage('error', `The add-in could not start: ${error?.message ?? error}`, { replace: true });
});

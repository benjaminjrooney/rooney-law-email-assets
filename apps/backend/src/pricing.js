/**
 * Postage cost estimation.
 *
 * Lob's API does not return a price for a letter — there is no price field on
 * the letter object and no pricing endpoint — so the only way to show a cost at
 * send time is to price it here from the firm's own rates.
 *
 * Those rates are NOT shipped with defaults on purpose. Lob does not publish a
 * fixed price list; per-piece pricing depends on the account's Print & Mail
 * Edition and volume. A plausible-looking guess would end up on a client's
 * invoice, so until the rates are configured the estimate is simply withheld.
 *
 * Every estimate is an estimate. Reconcile against the Lob invoice; see
 * docs/CENTERBASE.md.
 */

function money(name, env) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return null;
  const parsed = Number.parseFloat(String(raw).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid amount for ${name}: ${raw}`);
  }
  return parsed;
}

/** Round to cents, avoiding float drift like 1.0000000000000002. */
export function toCents(amount) {
  return Math.round(amount * 100) / 100;
}

export function loadRates(env = process.env) {
  const base = money('RATE_BASE', env);
  const rates = {
    currency: (env.RATE_CURRENCY ?? 'USD').trim() || 'USD',
    base,
    extraPage: money('RATE_EXTRA_PAGE', env) ?? 0,
    // Colour printing is usually priced separately; fall back to the mono rate.
    colorBase: money('RATE_COLOR_BASE', env),
    colorExtraPage: money('RATE_COLOR_EXTRA_PAGE', env),
    includedPages: Number.parseInt(env.RATE_INCLUDED_PAGES ?? '1', 10) || 1,
    // Some plans price per printed sheet rather than per page, which halves the
    // count for a double-sided letter.
    pricePerSheet: ['1', 'true', 'yes', 'on'].includes(String(env.RATE_PRICE_PER_SHEET ?? '').toLowerCase()),
    extraService: {
      certified: money('RATE_CERTIFIED', env),
      certified_return_receipt: money('RATE_CERTIFIED_RETURN_RECEIPT', env),
      registered: money('RATE_REGISTERED', env),
    },
  };
  rates.configured = base !== null;
  return rates;
}

/**
 * Estimate what one letter will cost.
 *
 * @param {object} options
 * @param {{id: string, extraService: string|null}} options.mailClass
 * @param {number|null} options.pages page count of the uploaded PDF
 * @param {boolean} options.color
 * @param {boolean} options.doubleSided
 * @param {string|null} options.addressPlacement
 * @param {object} options.rates from loadRates()
 * @returns {{
 *   available: boolean,
 *   currency: string,
 *   total: number|null,
 *   billablePages: number|null,
 *   breakdown: Array<{label: string, amount: number}>,
 *   notes: string[]
 * }}
 */
export function estimateLetterCost({ mailClass, pages, color, doubleSided, addressPlacement, rates }) {
  const currency = rates?.currency ?? 'USD';
  const notes = [];

  if (!rates?.configured) {
    return {
      available: false,
      currency,
      total: null,
      billablePages: null,
      breakdown: [],
      notes: ['Postage rates are not configured on the mail service, so no cost is shown.'],
    };
  }
  if (pages === null || pages === undefined) {
    return {
      available: false,
      currency,
      total: null,
      billablePages: null,
      breakdown: [],
      notes: ['The page count could not be read from the PDF, so no cost is shown.'],
    };
  }

  let billablePages = pages;
  if (addressPlacement === 'insert_blank_page') {
    billablePages += 1;
    notes.push('Includes the separate address page Lob inserts.');
  }
  if (mailClass.extraService) {
    // Lob adds a cover sheet for these and states it is not charged for.
    notes.push('The certified/registered cover sheet Lob adds is not charged for.');
  }

  const units = rates.pricePerSheet && doubleSided ? Math.ceil(billablePages / 2) : billablePages;
  if (rates.pricePerSheet && doubleSided) {
    notes.push('Priced per printed sheet, so a double-sided letter counts two pages per sheet.');
  }

  const baseRate = color ? rates.colorBase ?? rates.base : rates.base;
  const extraRate = color ? rates.colorExtraPage ?? rates.extraPage : rates.extraPage;

  const breakdown = [
    { label: color ? 'Colour letter, first page' : 'Letter, first page', amount: toCents(baseRate) },
  ];

  const extraUnits = Math.max(0, units - rates.includedPages);
  if (extraUnits > 0 && extraRate > 0) {
    breakdown.push({
      label: `${extraUnits} additional ${rates.pricePerSheet ? 'sheet' : 'page'}${extraUnits === 1 ? '' : 's'}`,
      amount: toCents(extraUnits * extraRate),
    });
  }

  if (mailClass.extraService) {
    const serviceRate = rates.extraService[mailClass.extraService];
    if (serviceRate === null || serviceRate === undefined) {
      return {
        available: false,
        currency,
        total: null,
        billablePages,
        breakdown: [],
        notes: [`No rate is configured for ${mailClass.extraService.replace(/_/g, ' ')}, so no cost is shown.`],
      };
    }
    breakdown.push({
      label: mailClass.extraService.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      amount: toCents(serviceRate),
    });
  }

  const total = toCents(breakdown.reduce((sum, line) => sum + line.amount, 0));
  return { available: true, currency, total, billablePages, breakdown, notes };
}

/** Add up per-letter estimates, staying unavailable if any letter is. */
export function sumEstimates(estimates, currency = 'USD') {
  const available = estimates.length > 0 && estimates.every((estimate) => estimate.available);
  return {
    available,
    currency: estimates[0]?.currency ?? currency,
    total: available ? toCents(estimates.reduce((sum, estimate) => sum + estimate.total, 0)) : null,
    letters: estimates.length,
  };
}

/** "$4.28" / "4.28 EUR" — currency formatting without pulling in Intl data. */
export function formatMoney(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return null;
  const fixed = amount.toFixed(2);
  return currency === 'USD' ? `$${fixed}` : `${fixed} ${currency}`;
}

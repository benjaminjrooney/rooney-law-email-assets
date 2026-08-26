import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import express from 'express';
import multer from 'multer';

import { requireApiToken } from './auth.js';
import { LobClient, LobError, summarizeLetter, summarizeVerification } from './lob.js';
import { LetterRateLimiter } from './rate-limit.js';
import { configProblems } from './config.js';
import { EventStore } from './event-store.js';
import { verifyWebhook } from './webhook.js';
import { estimateLetterCost, sumEstimates } from './pricing.js';
import {
  MAIL_CLASSES,
  ADDRESS_PLACEMENTS,
  validateLetterRequest,
  validateAddress,
  normalizeAddress,
  looksLikePdf,
  estimatePageCount,
} from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ADDIN_PUBLIC_DIR = path.resolve(here, '../../word-addin/public');

// Lob's domestic page ceiling; beyond this the letter is rejected at their end.
const MAX_PAGES_SINGLE_SIDED = 60;
const MAX_PAGES_DOUBLE_SIDED = 120;

function log(event, fields = {}) {
  const line = { ts: new Date().toISOString(), event, ...fields };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function corsMiddleware(allowedOrigins) {
  return function cors(req, res, next) {
    const origin = req.get('origin');
    if (origin && allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Api-Token');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

/**
 * Build the Express app.
 *
 * @param {object} options
 * @param {object} options.config from loadConfig()
 * @param {LobClient} [options.lobClient] injected in tests
 * @param {LetterRateLimiter} [options.rateLimiter]
 * @param {EventStore} [options.eventStore]
 */
export function createApp({ config, lobClient, rateLimiter, eventStore } = {}) {
  const lob =
    lobClient ??
    new LobClient({
      apiKey: config.lob.apiKey,
      baseUrl: config.lob.baseUrl,
      apiVersion: config.lob.apiVersion,
      timeoutMs: config.lob.timeoutMs,
    });

  const limiter =
    rateLimiter ??
    new LetterRateLimiter({ maxPerHour: config.limits.maxPerHour, maxPerDay: config.limits.maxPerDay });

  const events =
    eventStore ??
    new EventStore({
      maxEvents: config.events.maxEvents,
      logPath: config.events.logPath,
      onError: (message) => log('events.log_failed', { message }),
    });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.limits.maxFileBytes, files: 1, fields: 20 },
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(corsMiddleware(config.allowedOrigins));
  // The webhook signature covers the exact bytes Lob sent, so this route needs
  // the raw body. Mounted first: body-parser skips a request already parsed.
  app.use('/webhooks/lob', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '256kb' }));

  const guard = requireApiToken(config);

  // ---------------------------------------------------------------- health --

  app.get('/healthz', (_req, res) => {
    const problems = configProblems(config);
    res.json({
      ok: problems.length === 0,
      service: 'rooney-law-mail',
      lobMode: config.lob.apiKey.startsWith('live_') ? 'live' : config.lob.apiKey ? 'test' : 'unconfigured',
      configured: {
        apiToken: Boolean(config.apiToken),
        lobApiKey: Boolean(config.lob.apiKey),
        returnAddress: !problems.some((problem) => problem.startsWith('RETURN')),
      },
      problems,
    });
  });

  // ---------------------------------------------------------------- config --

  app.get('/api/config', guard, (_req, res) => {
    res.json({
      returnAddress: config.returnAddress,
      defaults: config.defaults,
      addressPlacements: ADDRESS_PLACEMENTS,
      mailClasses: Object.values(MAIL_CLASSES).map(({ id, label, tracked }) => ({ id, label, tracked })),
      lobMode: lob.isLive ? 'live' : 'test',
      limits: { maxFileBytes: config.limits.maxFileBytes, maxPerHour: config.limits.maxPerHour },
      features: {
        // Verification returns real answers only on a live key.
        addressCheck: lob.isLive,
        verifyBeforeSend: config.verifyBeforeSend,
        tracking: config.lob.webhookSecrets.length > 0,
        cancellationWindowMinutes: config.lob.cancellationWindowMinutes,
        costEstimate: config.rates.configured,
      },
    });
  });

  // ---------------------------------------------------------------- letters --

  /**
   * Shared front half of /api/letters and /api/estimate: check the upload,
   * validate the payload, and work out the mailings and what each would cost.
   *
   * @returns {{failure: {status: number, body: object}} | {value: object, pages: number|null, mailings: object[]}}
   */
  function readLetterRequest(req) {
    const fail = (status, message, details) => ({ failure: { status, body: { error: { message, details } } } });

    if (!req.file) return fail(400, 'No PDF was uploaded (form field "file").');
    if (!looksLikePdf(req.file.buffer)) {
      return fail(400, 'The uploaded file is not a PDF. Export the document as PDF and try again.');
    }

    let payload;
    try {
      payload = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
    } catch {
      return fail(400, 'Form field "payload" is not valid JSON.');
    }

    const { errors, value } = validateLetterRequest(payload, config);
    if (errors.length > 0) return fail(400, errors[0], errors);

    const pages = estimatePageCount(req.file.buffer);
    const pageLimit = value.options.doubleSided ? MAX_PAGES_DOUBLE_SIDED : MAX_PAGES_SINGLE_SIDED;
    if (pages !== null && pages > pageLimit) {
      return fail(400, `This document is about ${pages} pages; Lob's limit is ${pageLimit} for this setting.`);
    }

    // One physical letter per recipient: the addressee plus every CC copy.
    const mailings = [
      { role: 'to', address: value.to, mailClass: value.mailClass },
      ...value.cc.map((entry) => ({ role: 'cc', address: entry.address, mailClass: entry.mailClass })),
    ];

    for (const mailing of mailings) {
      // Certified and registered letters carry Lob's own cover sheet, so no
      // address page is inserted and none is priced.
      mailing.addressPlacement = mailing.mailClass.extraService ? null : value.options.addressPlacement;
      mailing.estimate = estimateLetterCost({
        mailClass: mailing.mailClass,
        pages,
        color: value.options.color,
        doubleSided: value.options.doubleSided,
        addressPlacement: mailing.addressPlacement,
        rates: config.rates,
      });
    }

    return { value, pages, mailings };
  }

  /**
   * Price a send without doing it: same inputs as /api/letters, no Lob call,
   * nothing created, nothing charged.
   */
  app.post('/api/estimate', guard, upload.single('file'), (req, res, next) => {
    try {
      const parsed = readLetterRequest(req);
      if (parsed.failure) return res.status(parsed.failure.status).json(parsed.failure.body);

      const { pages, mailings } = parsed;
      return res.json({
        pages,
        mode: lob.isLive ? 'live' : 'test',
        total: sumEstimates(mailings.map((mailing) => mailing.estimate), config.rates.currency),
        mailings: mailings.map((mailing) => ({
          role: mailing.role,
          mailClass: mailing.mailClass.id,
          recipient: mailing.address.name || mailing.address.company,
          estimate: mailing.estimate,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/letters', guard, upload.single('file'), async (req, res, next) => {
    try {
      const parsed = readLetterRequest(req);
      if (parsed.failure) return res.status(parsed.failure.status).json(parsed.failure.body);

      const { value, pages, mailings } = parsed;

      const allowance = limiter.check(mailings.length);
      if (!allowance.allowed) {
        return res.status(429).json({ error: { message: allowance.reason } });
      }

      // Optional pre-flight: catch an undeliverable address before any letter
      // is created, so a bad CC cannot leave a half-mailed batch behind.
      if (config.verifyBeforeSend && lob.isLive) {
        const undeliverable = [];
        for (const mailing of mailings) {
          try {
            const check = summarizeVerification(await lob.verifyUsAddress(mailing.address), { testMode: false });
            if (check.usable && check.deliverability === 'undeliverable') {
              const who = mailing.address.name || mailing.address.company;
              undeliverable.push(`${who}: ${check.message}`);
            }
          } catch (error) {
            // Verification is a safety net, not a gate: if the check itself
            // fails, fall through to Lob's own validation at creation time.
            log('verify.failed', { message: error.message });
          }
        }
        if (undeliverable.length > 0) {
          return res.status(400).json({
            error: {
              message: `Nothing was mailed — ${undeliverable.length === 1 ? 'an address is' : 'addresses are'} undeliverable.`,
              details: undeliverable,
            },
          });
        }
      }

      const baseKey = value.idempotencyKey || randomUUID();
      // Keep the name the add-in chose, minus anything that could confuse a
      // multipart header or a file path. Parentheses are allowed so the name
      // Lob records matches the document — "Smith demand (mailed).pdf".
      const filename = (req.file.originalname || 'letter.pdf').replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
      const results = [];
      let failures = 0;

      for (const [index, mailing] of mailings.entries()) {
        const recipientLabel = mailing.address.name || mailing.address.company;
        const description =
          value.options.description || `Word add-in letter to ${recipientLabel}`.slice(0, 255);

        try {
          const letter = await lob.createLetter({
            to: mailing.address,
            from: value.from,
            file: { buffer: req.file.buffer, filename },
            mailType: mailing.mailClass.mailType,
            extraService: mailing.mailClass.extraService,
            color: value.options.color,
            doubleSided: value.options.doubleSided,
            addressPlacement: mailing.addressPlacement,
            description,
            useType: config.lob.useType,
            metadata: { ...value.metadata, role: mailing.role },
            idempotencyKey: `${baseKey}:${index}`,
            billingGroupId: value.billingGroupId,
          });

          limiter.record(1);
          const summary = summarizeLetter(letter);
          results.push({
            role: mailing.role,
            ok: true,
            mailClass: mailing.mailClass.id,
            letter: summary,
            estimate: mailing.estimate,
          });
          log('letter.created', {
            id: summary.id,
            role: mailing.role,
            mailClass: mailing.mailClass.id,
            recipient: recipientLabel,
            city: mailing.address.address_city,
            trackingNumber: summary.trackingNumber,
            mode: lob.isLive ? 'live' : 'test',
          });
        } catch (error) {
          if (!(error instanceof LobError)) throw error;
          failures += 1;
          log('letter.failed', {
            role: mailing.role,
            recipient: recipientLabel,
            message: error.message,
            lobCode: error.lobCode,
            statusCode: error.statusCode,
          });
          // A failure on the primary recipient means nothing useful was mailed.
          if (mailing.role === 'to') {
            return res.status(error.statusCode).json({
              error: { message: error.message, code: error.lobCode, requestId: error.requestId },
            });
          }
          results.push({
            role: mailing.role,
            ok: false,
            mailClass: mailing.mailClass.id,
            recipient: recipientLabel,
            error: { message: error.message, code: error.lobCode },
          });
        }
      }

      return res.status(failures > 0 ? 207 : 201).json({
        ok: failures === 0,
        mode: lob.isLive ? 'live' : 'test',
        pages,
        // Only what actually went out is priced.
        total: sumEstimates(
          results.filter((result) => result.ok).map((result) => result.estimate),
          config.rates.currency,
        ),
        mailings: results,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/letters/:id', guard, async (req, res, next) => {
    try {
      const letter = await lob.getLetter(req.params.id);
      res.json({
        letter: summarizeLetter(letter),
        status: letter?.status ?? null,
        events: letter?.tracking_events ?? [],
        lastEvent: events.latestFor(req.params.id),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Pull a letter back out of production. Lob allows this only until the
   * letter's send_date — five minutes after creation on a default account.
   */
  app.post('/api/letters/:id/cancel', guard, async (req, res, next) => {
    try {
      const result = await lob.cancelLetter(req.params.id);
      log('letter.canceled', { id: req.params.id });
      res.json({ ok: true, id: req.params.id, deleted: result?.deleted ?? true });
    } catch (error) {
      if (error instanceof LobError) {
        log('letter.cancel_failed', { id: req.params.id, message: error.message, statusCode: error.statusCode });
        // Past the window Lob answers 404/422; say what that means rather than
        // leaving the user wondering whether the letter is coming back.
        const tooLate = error.statusCode === 404 || error.statusCode === 422;
        return res.status(error.statusCode).json({
          error: {
            message: tooLate
              ? `This letter can no longer be canceled — it has gone to print. (Lob: ${error.message})`
              : error.message,
            code: error.lobCode,
          },
        });
      }
      next(error);
    }
  });

  // ------------------------------------------------------------- addresses --

  /** Check one address against USPS data without creating a letter. */
  app.post('/api/addresses/verify', guard, async (req, res, next) => {
    try {
      const address = normalizeAddress(req.body?.address ?? req.body);
      const problems = validateAddress(address, '');
      if (problems.length > 0) {
        return res.status(400).json({ error: { message: problems[0], details: problems } });
      }

      const verification = await lob.verifyUsAddress(address);
      const summary = summarizeVerification(verification, { testMode: !lob.isLive });
      res.json({ ...summary, submitted: address });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------- tracking --

  /**
   * Lob's webhook receiver. Authenticated by signature rather than by the
   * add-in's token: Lob cannot send one, and the signature proves origin.
   */
  app.post('/webhooks/lob', async (req, res) => {
    const verdict = verifyWebhook({
      secrets: config.lob.webhookSecrets,
      signature: req.get('lob-signature'),
      timestamp: req.get('lob-signature-timestamp'),
      rawBody: req.body,
    });

    if (!verdict.ok) {
      log('webhook.rejected', { message: verdict.message });
      return res.status(verdict.status).json({ error: { message: verdict.message } });
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
    } catch {
      return res.status(400).json({ error: { message: 'Webhook body is not valid JSON.' } });
    }

    const event = await events.record(payload);
    log('webhook.received', {
      eventType: event.eventType,
      letterId: event.letterId,
      recipient: event.recipient,
      notable: event.notable,
    });

    // Always 200 once the signature checks out: Lob retries non-2xx, and a
    // replayed delivery would only duplicate an event we already hold.
    res.json({ ok: true });
  });

  /** Recent mailings, from Lob, annotated with the latest tracking event. */
  app.get('/api/mailings', guard, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '10', 10) || 10, 1), 50);
      const response = await lob.listLetters({ limit });
      const mailings = (response?.data ?? []).map((letter) => ({
        ...summarizeLetter(letter),
        description: letter?.description ?? null,
        lastEvent: events.latestFor(letter?.id),
      }));
      res.json({ mailings, trackingConfigured: config.lob.webhookSecrets.length > 0 });
    } catch (error) {
      next(error);
    }
  });

  /** Everything the webhook has told us, newest first. */
  app.get('/api/events', guard, (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
    res.json({ events: events.recent(limit), trackingConfigured: config.lob.webhookSecrets.length > 0 });
  });

  // ----------------------------------------------------------- add-in files --

  if (config.serveAddin) {
    app.use('/addin', express.static(ADDIN_PUBLIC_DIR, { extensions: ['html'], maxAge: '5m' }));
    app.get('/', (_req, res) => res.redirect('/addin/taskpane.html'));
  }

  // -------------------------------------------------------------- fallbacks --

  app.use((req, res) => {
    res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });
  });

  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
  app.use((error, req, res, _next) => {
    if (error instanceof LobError) {
      return res.status(error.statusCode).json({ error: { message: error.message, code: error.lobCode } });
    }
    if (error?.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(config.limits.maxFileBytes / (1024 * 1024));
      return res.status(413).json({ error: { message: `PDF is larger than the ${mb} MB limit.` } });
    }
    log('request.error', { path: req.path, message: error?.message, stack: error?.stack });
    return res.status(500).json({ error: { message: 'Unexpected server error. Check the Railway logs.' } });
  });

  return app;
}

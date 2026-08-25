import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import express from 'express';
import multer from 'multer';

import { requireApiToken } from './auth.js';
import { LobClient, LobError, summarizeLetter } from './lob.js';
import { LetterRateLimiter } from './rate-limit.js';
import { configProblems } from './config.js';
import {
  MAIL_CLASSES,
  ADDRESS_PLACEMENTS,
  validateLetterRequest,
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
 */
export function createApp({ config, lobClient, rateLimiter } = {}) {
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

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.limits.maxFileBytes, files: 1, fields: 20 },
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(corsMiddleware(config.allowedOrigins));
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
    });
  });

  // ---------------------------------------------------------------- letters --

  app.post('/api/letters', guard, upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: { message: 'No PDF was uploaded (form field "file").' } });
      }
      if (!looksLikePdf(req.file.buffer)) {
        return res.status(400).json({
          error: { message: 'The uploaded file is not a PDF. Export the document as PDF and try again.' },
        });
      }

      let payload;
      try {
        payload = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
      } catch {
        return res.status(400).json({ error: { message: 'Form field "payload" is not valid JSON.' } });
      }

      const { errors, value } = validateLetterRequest(payload, config);
      if (errors.length > 0) {
        return res.status(400).json({ error: { message: errors[0], details: errors } });
      }

      const pages = estimatePageCount(req.file.buffer);
      const pageLimit = value.options.doubleSided ? MAX_PAGES_DOUBLE_SIDED : MAX_PAGES_SINGLE_SIDED;
      if (pages !== null && pages > pageLimit) {
        return res.status(400).json({
          error: {
            message: `This document is about ${pages} pages; Lob's limit is ${pageLimit} for this setting.`,
          },
        });
      }

      // One physical letter per recipient: the addressee plus every CC copy.
      const mailings = [
        { role: 'to', address: value.to, mailClass: value.mailClass },
        ...value.cc.map((entry) => ({ role: 'cc', address: entry.address, mailClass: entry.mailClass })),
      ];

      const allowance = limiter.check(mailings.length);
      if (!allowance.allowed) {
        return res.status(429).json({ error: { message: allowance.reason } });
      }

      const baseKey = value.idempotencyKey || randomUUID();
      const filename = (req.file.originalname || 'letter.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
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
            // Certified/registered letters get a Lob-generated cover sheet that
            // already carries the address block, so no placement is sent.
            addressPlacement: mailing.mailClass.extraService ? null : value.options.addressPlacement,
            description,
            useType: config.lob.useType,
            metadata: { ...value.metadata, role: mailing.role },
            idempotencyKey: `${baseKey}:${index}`,
          });

          limiter.record(1);
          const summary = summarizeLetter(letter);
          results.push({ role: mailing.role, ok: true, mailClass: mailing.mailClass.id, letter: summary });
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
        mailings: results,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/letters/:id', guard, async (req, res, next) => {
    try {
      const letter = await lob.getLetter(req.params.id);
      res.json({ letter: summarizeLetter(letter), status: letter?.status ?? null, events: letter?.tracking_events ?? [] });
    } catch (error) {
      next(error);
    }
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

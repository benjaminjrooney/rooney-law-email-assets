import { createApp } from './app.js';
import { loadConfig, configProblems } from './config.js';

const config = loadConfig();
const problems = configProblems(config);

for (const problem of problems) {
  process.stderr.write(`[config] ${problem}\n`);
}

const app = createApp({ config });

// Reload tracking history before accepting traffic, so the "Recent mail" panel
// is not blank after a deploy. Without EVENT_LOG_PATH this is a no-op.
const restored = await app.locals.eventStore.restore();

/**
 * Where the event log actually lives, as opposed to where it was configured to.
 * A path set without a volume behind it looks correct everywhere else, so it is
 * worth saying plainly in the one line someone reads after a deploy.
 */
function describeEventLog() {
  if (!config.events.logPath) return 'memory only (lost on restart)';
  if (restored.durable === false) return `${config.events.logPath} (NOT on a volume — lost on restart)`;
  return config.events.logPath;
}

app.listen(config.port, () => {
  const mode = config.lob.apiKey.startsWith('live_') ? 'LIVE (real postage)' : 'test';
  process.stdout.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      event: 'server.started',
      port: config.port,
      lobMode: mode,
      configProblems: problems.length,
      eventsRestored: restored.restored,
      eventLog: describeEventLog(),
      // Settings that are otherwise invisible until someone mails a letter and
      // notices the behaviour they expected did not happen.
      verifyBeforeSend: config.verifyBeforeSend,
      tracking: config.lob.webhookSecrets.length > 0,
      costEstimate: config.rates.configured,
      addressPlacement: config.defaults.addressPlacement,
    })}\n`,
  );
});

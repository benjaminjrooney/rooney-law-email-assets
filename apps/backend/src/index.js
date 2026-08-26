import { createApp } from './app.js';
import { loadConfig, configProblems } from './config.js';

const config = loadConfig();
const problems = configProblems(config);

for (const problem of problems) {
  process.stderr.write(`[config] ${problem}\n`);
}

const app = createApp({ config });

app.listen(config.port, () => {
  const mode = config.lob.apiKey.startsWith('live_') ? 'LIVE (real postage)' : 'test';
  process.stdout.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      event: 'server.started',
      port: config.port,
      lobMode: mode,
      configProblems: problems.length,
    })}\n`,
  );
});

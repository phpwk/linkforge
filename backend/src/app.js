'use strict';

const express = require('express');
const { createPool } = require('./db');
const { register, httpMetricsMiddleware } = require('./metrics');
const { buildLinksRouter } = require('./routes/links');

/**
 * Builds the Express app given a pg Pool. Separated from process
 * bootstrap (below) so tests can build an app against a pool of
 * their choosing without spinning up a real HTTP listener.
 */
function buildApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(httpMetricsMiddleware);

  // Liveness: process is up and can serve HTTP. Deliberately does
  // NOT touch the database — a slow DB shouldn't make Kubernetes
  // kill and restart a perfectly healthy pod.
  app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

  // Readiness: process is up AND can reach its dependencies. This
  // is what should gate whether the Service sends traffic to the pod.
  app.get('/readyz', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', error: err.message });
    }
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use(buildLinksRouter(pool));

  // Fallback 404 for anything that isn't a known route or a link code
  // that doesn't exist (the :code handler above already 404s those).
  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  return app;
}

/* istanbul ignore next -- process bootstrap, exercised by integration
   tests through buildApp() rather than by starting a real listener */
function main() {
  const pool = createPool();
  const app = buildApp(pool);
  const port = Number(process.env.PORT || 8080);

  const server = app.listen(port, () => {
    console.log(`linkforge-api listening on :${port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      pool.end().then(() => process.exit(0));
    });
    // Don't hang forever waiting for in-flight requests.
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  main();
}

module.exports = { buildApp };

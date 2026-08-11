'use strict';

const client = require('prom-client');

/**
 * One registry per process. Default Node.js runtime metrics
 * (event loop lag, heap, GC) are included for free — they're
 * usually the first thing you want when a pod starts misbehaving.
 */
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'linkforge_' });

const httpRequestDuration = new client.Histogram({
  name: 'linkforge_http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labeled by route/method/status',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'linkforge_http_requests_total',
  help: 'Total HTTP requests, labeled by route/method/status',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const linksCreatedTotal = new client.Counter({
  name: 'linkforge_links_created_total',
  help: 'Total short links created',
  registers: [register],
});

const linksRedirectedTotal = new client.Counter({
  name: 'linkforge_links_redirected_total',
  help: 'Total redirects served',
  registers: [register],
});

/**
 * Express middleware that records duration + count for every request.
 * Uses res.on('finish') rather than wrapping res.end so it works
 * regardless of how downstream handlers send the response.
 */
function httpMetricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // req.route is only set once Express has matched a route; for
    // 404s it's undefined, so fall back to a fixed label to avoid
    // an unbounded cardinality explosion from arbitrary paths.
    const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
    const labels = { method: req.method, route, status_code: res.statusCode };
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestsTotal.inc(labels);
  });
  next();
}

module.exports = {
  register,
  httpMetricsMiddleware,
  linksCreatedTotal,
  linksRedirectedTotal,
};

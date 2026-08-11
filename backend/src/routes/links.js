'use strict';

const express = require('express');
const { nanoid } = require('nanoid');
const { linksCreatedTotal, linksRedirectedTotal } = require('../metrics');

const CODE_LENGTH = 7;
const URL_RE = /^https?:\/\/.+/i;

/**
 * Builds the links router. Takes `pool` as a parameter (rather than
 * importing a singleton) so unit tests can inject a fake and
 * integration tests can inject a pool pointed at a throwaway schema.
 */
function buildLinksRouter(pool) {
  const router = express.Router();

  // POST /api/links { url } -> { code, shortUrl, originalUrl }
  router.post('/api/links', async (req, res) => {
    const { url } = req.body || {};

    if (typeof url !== 'string' || !URL_RE.test(url)) {
      return res.status(400).json({ error: 'url must be an absolute http(s) URL' });
    }

    // Collision probability at 7 base62 chars is ~3.5e12 possible
    // codes; retrying on the rare unique-violation is simpler and
    // safer than trying to pre-check availability under concurrency.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const code = nanoid(CODE_LENGTH);
      try {
        const result = await pool.query(
          'INSERT INTO links (code, original_url) VALUES ($1, $2) RETURNING code, original_url, created_at',
          [code, url]
        );
        linksCreatedTotal.inc();
        const row = result.rows[0];
        return res.status(201).json({
          code: row.code,
          originalUrl: row.original_url,
          createdAt: row.created_at,
        });
      } catch (err) {
        if (err.code === '23505') continue; // unique_violation on code — retry
        req.log?.error?.(err);
        return res.status(500).json({ error: 'internal error' });
      }
    }
    return res.status(503).json({ error: 'could not allocate a unique code, try again' });
  });

  // GET /api/links -> most recent links (bounded, no unbounded scans)
  router.get('/api/links', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    try {
      const result = await pool.query(
        'SELECT code, original_url, clicks, created_at FROM links ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      res.json(result.rows.map(rowToJson));
    } catch (err) {
      req.log?.error?.(err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // GET /api/links/:code/stats -> single link detail
  router.get('/api/links/:code/stats', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT code, original_url, clicks, created_at FROM links WHERE code = $1',
        [req.params.code]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
      res.json(rowToJson(result.rows[0]));
    } catch (err) {
      req.log?.error?.(err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // GET /:code -> 302 redirect, increments click count atomically
  router.get('/:code', async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE links SET clicks = clicks + 1 WHERE code = $1 RETURNING original_url',
        [req.params.code]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
      linksRedirectedTotal.inc();
      res.redirect(302, result.rows[0].original_url);
    } catch (err) {
      req.log?.error?.(err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}

function rowToJson(row) {
  return {
    code: row.code,
    originalUrl: row.original_url,
    clicks: Number(row.clicks),
    createdAt: row.created_at,
  };
}

module.exports = { buildLinksRouter };

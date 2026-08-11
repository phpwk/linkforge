'use strict';

const request = require('supertest');
const { buildApp } = require('../src/app');

/** Minimal fake of the pg Pool surface the app actually uses. */
function fakePool(handlers) {
  return { query: jest.fn((sql, params) => handlers(sql, params)) };
}

describe('POST /api/links', () => {
  test('rejects a missing url', async () => {
    const app = buildApp(fakePool(() => { throw new Error('should not query'); }));
    const res = await request(app).post('/api/links').send({});
    expect(res.status).toBe(400);
  });

  test('rejects a non-http(s) url', async () => {
    const app = buildApp(fakePool(() => { throw new Error('should not query'); }));
    const res = await request(app).post('/api/links').send({ url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });

  test('returns 201 with the created code on success', async () => {
    const app = buildApp(
      fakePool((sql) => {
        if (sql.startsWith('INSERT')) {
          return {
            rows: [{ code: 'abc1234', original_url: 'https://example.com', created_at: new Date().toISOString() }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      })
    );
    const res = await request(app).post('/api/links').send({ url: 'https://example.com' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('abc1234');
    expect(res.body.originalUrl).toBe('https://example.com');
  });

  test('retries on code collision (unique_violation) then succeeds', async () => {
    let calls = 0;
    const app = buildApp(
      fakePool((sql) => {
        if (sql.startsWith('INSERT')) {
          calls += 1;
          if (calls === 1) {
            const err = new Error('duplicate key');
            err.code = '23505';
            throw err;
          }
          return { rows: [{ code: 'zzz9999', original_url: 'https://retry.example', created_at: new Date().toISOString() }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      })
    );
    const res = await request(app).post('/api/links').send({ url: 'https://retry.example' });
    expect(res.status).toBe(201);
    expect(calls).toBe(2);
  });
});

describe('GET /:code', () => {
  test('302s to the original url and increments clicks', async () => {
    const app = buildApp(
      fakePool((sql, params) => {
        expect(sql.startsWith('UPDATE links')).toBe(true);
        expect(params).toEqual(['abc1234']);
        return { rows: [{ original_url: 'https://example.com/target' }] };
      })
    );
    const res = await request(app).get('/abc1234');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/target');
  });

  test('404s for an unknown code', async () => {
    const app = buildApp(fakePool(() => ({ rows: [] })));
    const res = await request(app).get('/doesnotexist');
    expect(res.status).toBe(404);
  });
});

describe('health endpoints', () => {
  test('/healthz never touches the database', async () => {
    const app = buildApp(fakePool(() => { throw new Error('should not query'); }));
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
  });

  test('/readyz reports 503 when the database is unreachable', async () => {
    const app = buildApp(fakePool(() => { throw new Error('connection refused'); }));
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
  });

  test('/readyz reports 200 when the database responds', async () => {
    const app = buildApp(fakePool(() => ({ rows: [{ '?column?': 1 }] })));
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
  });
});

describe('GET /metrics', () => {
  test('exposes Prometheus text exposition format', async () => {
    const app = buildApp(fakePool(() => ({ rows: [] })));
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('linkforge_http_requests_total');
  });
});

'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createPool } = require('../src/db');
const { buildApp } = require('../src/app');

// Requires a reachable Postgres — see README "Running tests locally".
// CI runs this against a postgres:16 service container.
const pool = createPool(process.env);
const app = buildApp(pool);

beforeAll(async () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'migrations', '001_init.sql'),
    'utf8'
  );
  await pool.query(migration);
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE links RESTART IDENTITY');
});

afterAll(async () => {
  await pool.end();
});

test('full lifecycle: create, list, redirect, stats reflect the click', async () => {
  const create = await request(app).post('/api/links').send({ url: 'https://example.com/integration' });
  expect(create.status).toBe(201);
  const { code } = create.body;

  const list = await request(app).get('/api/links');
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
  expect(list.body[0].clicks).toBe(0);

  const redirect = await request(app).get(`/${code}`);
  expect(redirect.status).toBe(302);
  expect(redirect.headers.location).toBe('https://example.com/integration');

  const stats = await request(app).get(`/api/links/${code}/stats`);
  expect(stats.status).toBe(200);
  expect(stats.body.clicks).toBe(1);
});

test('two concurrent link creations never collide on code', async () => {
  const [a, b] = await Promise.all([
    request(app).post('/api/links').send({ url: 'https://example.com/a' }),
    request(app).post('/api/links').send({ url: 'https://example.com/b' }),
  ]);
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(a.body.code).not.toBe(b.body.code);
});

test('readyz is 200 against a live database', async () => {
  const res = await request(app).get('/readyz');
  expect(res.status).toBe(200);
});

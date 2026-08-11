'use strict';

const { Pool } = require('pg');

/**
 * Creates a pg Pool from environment variables. Kept as a factory
 * (rather than a module-level singleton) so tests can construct
 * pools pointed at different databases without env-var gymnastics.
 */
function createPool(env = process.env) {
  return new Pool({
    host: env.PGHOST || 'localhost',
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || 'linkforge',
    password: env.PGPASSWORD || 'linkforge',
    database: env.PGDATABASE || 'linkforge',
    max: Number(env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

module.exports = { createPool };

// Single shared connection pool. Every query in the app should
// go through this — never create a new client per request.
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error("DATABASE_URL_POOLED or DATABASE_URL is required");
}

let databaseHost;
try {
    databaseHost = new URL(connectionString).hostname;
} catch {
    throw new Error("The configured database URL is invalid");
}

if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost)) {
    throw new Error("The configured database URL must not point to localhost");
}

const pool = new Pool({ connectionString });

pool.on('error', (err) => {
    // A background/idle client crashed unexpectedly — log it, don't
    // let it crash the whole server.
    console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;

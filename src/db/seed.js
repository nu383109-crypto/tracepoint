require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seedAdmin() {
    const email = (process.env.ADMIN_EMAIL || 'admin@tracepoint.com').trim().toLowerCase();
    const name = (process.env.ADMIN_NAME || 'TracePoint Administrator').trim();
    const password = process.env.ADMIN_PASSWORD;

    if (!name || !email) {
        throw new Error('ADMIN_NAME and ADMIN_EMAIL must not be empty.');
    }
    if (!password || password.length < 6) {
        throw new Error('Set ADMIN_PASSWORD to a value of at least 6 characters.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
        `INSERT INTO users (id, name, email, password_hash, role, status, must_change_password)
         VALUES (1, $1, $2, $3, 'IT/Systems Administrator', 'Active', TRUE)
         ON CONFLICT (email) DO UPDATE SET
             password_hash = CASE WHEN users.must_change_password OR users.password_hash = '123456' THEN EXCLUDED.password_hash ELSE users.password_hash END,
             must_change_password = CASE WHEN users.password_hash = '123456' THEN TRUE ELSE users.must_change_password END`,
        [name, email, passwordHash]
    );
    await pool.query("SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1))");
    console.log(`Administrator seed complete for ${email}.`);
}

seedAdmin()
    .catch((err) => {
        console.error('Admin seed failed:', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
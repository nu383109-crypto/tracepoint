const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createHash, randomBytes } = require('node:crypto');
const pool = require('../db/pool');
const { isMailConfigured, sendPasswordResetEmail } = require('../utils/email');

function createToken(userId) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured.');
    }
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '12h' });
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        mustChangePassword: user.must_change_password
    };
}

async function login(req, res) {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
        return res.status(400).json({ message: 'Enter your email and password.' });
    }

    try {
        const result = await pool.query(
            `SELECT id, name, email, password_hash, role, status, must_change_password
             FROM users WHERE LOWER(email) = $1`,
            [email]
        );
        const user = result.rows[0];

        if (!user || user.status !== 'Active' || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ message: 'Email or password is incorrect.' });
        }

        res.json({ token: createToken(user.id), user: publicUser(user) });
    } catch (err) {
        console.error('login error:', err);
        res.status(500).json({ message: 'Unable to sign in.' });
    }
}

async function register(req, res) {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !email || password.length < 6) {
        return res.status(400).json({ message: 'Enter your name, email, and a password of at least 6 characters.' });
    }

    try {
        const userCountResult = await pool.query('SELECT COUNT(*)::int AS total FROM users');
        const isFirstUser = userCountResult.rows[0].total === 0;
        const role = isFirstUser ? 'IT/Systems Administrator' : 'Field Technician';
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            `INSERT INTO users (name, email, password_hash, role, status, must_change_password)
             VALUES ($1, $2, $3, $4, 'Active', $5)
             RETURNING id, name, email, role, status, must_change_password`,
            [name, email, passwordHash, role, isFirstUser]
        );
        res.status(201).json(publicUser(result.rows[0]));
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'An account with that email already exists.' });
        }
        console.error('register error:', err);
        res.status(500).json({ message: 'Unable to create your account.' });
    }
}

async function changePassword(req, res) {
    const name = String(req.body.name || '').trim();
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (req.user.must_change_password && !name) {
        return res.status(400).json({ message: 'Enter your name.' });
    }
    if (newPassword && newPassword.length < 6) {
        return res.status(400).json({ message: 'Choose a password with at least 6 characters.' });
    }
    if (!newPassword && !req.user.must_change_password) {
        return res.status(400).json({ message: 'Enter a new password.' });
    }

    try {
        const current = await pool.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [req.user.id]
        );
        const currentHash = current.rows[0].password_hash;
        if (!req.user.must_change_password && !(await bcrypt.compare(currentPassword, currentHash))) {
            return res.status(403).json({ message: 'Your current password is incorrect.' });
        }
        if (newPassword && await bcrypt.compare(newPassword, currentHash)) {
            return res.status(400).json({ message: 'Choose a password different from your current password.' });
        }

        const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : null;
        const result = await pool.query(
            `UPDATE users
             SET name = COALESCE(NULLIF($1, ''), name),
                 password_hash = COALESCE($2, password_hash),
                 must_change_password = FALSE
             WHERE id = $3
             RETURNING id, name, email, role, status, must_change_password`,
            [name, passwordHash, req.user.id]
        );
        res.json({ message: newPassword ? 'Account updated.' : 'Name updated; password unchanged.', user: publicUser(result.rows[0]) });
    } catch (err) {
        console.error('changePassword error:', err);
        res.status(500).json({ message: 'Unable to update your password.' });
    }
}

async function requestPasswordReset(req, res) {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
        return res.status(400).json({ message: 'Enter your account email.' });
    }
    if (!isMailConfigured()) {
        return res.status(503).json({ message: 'Password recovery email is not configured. Contact your system administrator.' });
    }

    try {
        const result = await pool.query(
            "SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND status = 'Active'",
            [email]
        );
        const user = result.rows[0];

        if (user) {
            const token = randomBytes(32).toString('hex');
            const tokenHash = createHash('sha256').update(token).digest('hex');
            const baseUrl = process.env.APP_BASE_URL.replace(/\/$/, '');
            const resetUrl = `${baseUrl}/resetPassword.html?token=${token}`;

            await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
            await pool.query(
                `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
                 VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
                [user.id, tokenHash]
            );

            try {
                await sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl });
            } catch (err) {
                await pool.query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [tokenHash]);
                throw err;
            }
        }

        res.json({ message: 'If an active account matches that email, password reset instructions have been sent.' });
    } catch (err) {
        console.error('requestPasswordReset error:', err);
        res.status(500).json({ message: 'Unable to send password reset instructions.' });
    }
}

async function resetPassword(req, res) {
    const token = String(req.body.token || '');
    const newPassword = String(req.body.newPassword || '');

    if (!/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).json({ message: 'This password reset link is invalid or expired.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Choose a password with at least 6 characters.' });
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const result = await client.query(
            'SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW() FOR UPDATE',
            [tokenHash]
        );
        if (!result.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This password reset link is invalid or expired.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        const update = await client.query(
            "UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2 AND status = 'Active'",
            [passwordHash, result.rows[0].user_id]
        );
        if (!update.rowCount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'This password reset link is invalid or expired.' });
        }
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [result.rows[0].user_id]);
        await client.query('COMMIT');
        res.json({ message: 'Password reset. Sign in with your new password.' });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('resetPassword error:', err);
        res.status(500).json({ message: 'Unable to reset password.' });
    } finally {
        if (client) client.release();
    }
}

function logout(req, res) {
    res.json({ message: 'Signed out.' });
}

module.exports = { login, register, changePassword, requestPasswordReset, resetPassword, logout };
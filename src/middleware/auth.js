const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

async function authenticate(req, res, next) {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : null;

    if (!token || !process.env.JWT_SECRET) {
        return res.status(401).json({ message: 'Please sign in.' });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const result = await pool.query(
            'SELECT id, name, email, role, status, must_change_password FROM users WHERE id = $1',
            [payload.id]
        );
        const user = result.rows[0];

        if (!user || user.status !== 'Active') {
            return res.status(401).json({ message: 'This account is unavailable.' });
        }

        if (user.must_change_password && !(req.baseUrl === '/api/auth' && req.path === '/password')) {
            return res.status(403).json({
                code: 'PASSWORD_RESET_REQUIRED',
                message: 'Change your password before continuing.'
            });
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Your session is invalid. Please sign in again.' });
        }
        next(err);
    }
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'You do not have permission to do this.' });
        }
        next();
    };
}

module.exports = { authenticate, requireRole };

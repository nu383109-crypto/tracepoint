const pool = require('../db/pool');
const { recordAudit } = require('./auditController');

// GET /api/users — Administrator only (route enforces this)
async function listUsers(req, res) {
    try {
        const result = await pool.query(
            `SELECT id, name, email, role, status, created_at FROM users ORDER BY id`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('listUsers error:', err);
        res.status(500).json({ message: 'Failed to fetch users.' });
    }
}

// PATCH /api/users/:id/role — change a user's role
// Enforces server-side what the frontend only enforced visually:
// nobody can change their own role.
async function changeUserRole(req, res) {
    const targetId = parseInt(req.params.id, 10);
    const { role } = req.body;

    if (targetId === req.user.id) {
        return res.status(403).json({ message: 'You cannot change your own role.' });
    }

    const validRoles = ['Field Technician', 'Maintenance Supervisor', 'IT/Systems Administrator'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ message: 'Invalid role.' });
    }

    try {
        const result = await pool.query(
            `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role, status`,
            [role, targetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        await recordAudit({
            action: 'Role Changed',
            description: `Changed ${result.rows[0].name}'s role to ${role}`,
            performedBy: req.user.id,
            role: req.user.role,
        });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('changeUserRole error:', err);
        res.status(500).json({ message: 'Failed to change role.' });
    }
}

// PATCH /api/users/:id/status — enable/disable an account
async function setUserStatus(req, res) {
    const targetId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (targetId === req.user.id) {
        return res.status(403).json({ message: 'You cannot change your own account status.' });
    }

    if (!['Active', 'Disabled'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status.' });
    }

    try {
        const result = await pool.query(
            `UPDATE users SET status = $1 WHERE id = $2 RETURNING id, name, email, role, status`,
            [status, targetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        await recordAudit({
            action: status === 'Disabled' ? 'Account Disabled' : 'Account Enabled',
            description: `${status === 'Disabled' ? 'Disabled' : 'Enabled'} ${result.rows[0].name}'s account`,
            performedBy: req.user.id,
            role: req.user.role,
        });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('setUserStatus error:', err);
        res.status(500).json({ message: 'Failed to update user status.' });
    }
}

module.exports = { listUsers, changeUserRole, setUserStatus };

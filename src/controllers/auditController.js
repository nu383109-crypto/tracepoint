const pool = require('../db/pool');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

// Call this from other controllers after a sensitive action
// (role change, user disable, kiosk/component creation, etc).
// NFR-4/NFR-6: the backend writes audit rows itself — never trust
// the client to report what it did.
async function recordAudit({ action, description, performedBy, role }, client = pool) {
    await client.query(
        `INSERT INTO audit_logs (action, description, performed_by, role) VALUES ($1, $2, $3, $4)`,
        [action, description || null, performedBy, role]
    );
}

// GET /api/audit-logs?page=&limit=
async function listAuditLogs(req, res) {
    const { page, limit, offset } = parsePagination(req.query);

    try {
        const dataResult = await pool.query(
            `SELECT a.*, u.name AS performed_by_name
             FROM audit_logs a
             JOIN users u ON u.id = a.performed_by
             ORDER BY a.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        const countResult = await pool.query(`SELECT COUNT(*) FROM audit_logs`);
        const total = parseInt(countResult.rows[0].count, 10);

        res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (err) {
        console.error('listAuditLogs error:', err);
        res.status(500).json({ message: 'Failed to fetch audit logs.' });
    }
}

module.exports = { recordAudit, listAuditLogs };

const pool = require('../db/pool');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

// GET /api/kiosks?search=&page=&limit=
// Mirrors listComponents: same search/pagination shape, but also
// returns a live component_count per kiosk (fixes the bug where the
// old frontend hardcoded this number and it never updated).
async function listKiosks(req, res) {
    const { page, limit, offset } = parsePagination(req.query);
    const search = (req.query.search || '').trim();

    const whereClause = search ? `WHERE k.kiosk_code ILIKE $1 OR k.location ILIKE $1` : '';
    const searchParam = search ? [`%${search}%`] : [];

    const dataQuery = `
        SELECT k.id, k.kiosk_code, k.location, k.status, k.installed_at,
               COUNT(c.id) FILTER (WHERE c.status = 'Installed') AS component_count
        FROM kiosks k
        LEFT JOIN components c ON c.kiosk_id = k.id
        ${whereClause}
        GROUP BY k.id
        ORDER BY k.id
        LIMIT $${searchParam.length + 1} OFFSET $${searchParam.length + 2}
    `;
    const countQuery = `SELECT COUNT(*) FROM kiosks k ${whereClause}`;

    try {
        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, [...searchParam, limit, offset]),
            pool.query(countQuery, searchParam),
        ]);

        const total = parseInt(countResult.rows[0].count, 10);
        res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (err) {
        console.error('listKiosks error:', err);
        res.status(500).json({ message: 'Failed to fetch kiosks.' });
    }
}

// GET /api/kiosks/:id — current bill of components (FR-2.2) plus
// movement history (any event that had this kiosk as source or
// destination), independent of what's currently installed (FR-4.3
// needs kiosk history to survive components moving away).
async function getKiosk(req, res) {
    const { id } = req.params;

    try {
        const kioskResult = await pool.query(`SELECT * FROM kiosks WHERE id = $1`, [id]);
        if (kioskResult.rows.length === 0) {
            return res.status(404).json({ message: 'Kiosk not found.' });
        }

        const componentsResult = await pool.query(
            `SELECT id, serial, type, manufacturer, model, status, warranty_expires_on
             FROM components
             WHERE kiosk_id = $1 AND status = 'Installed'
             ORDER BY type`,
            [id]
        );

        const historyResult = await pool.query(
            `SELECT e.*, u.name AS performed_by_name, c.serial AS component_serial,
                    fk.kiosk_code AS from_kiosk_code, tk.kiosk_code AS to_kiosk_code
             FROM component_events e
             JOIN users u ON u.id = e.performed_by
             JOIN components c ON c.id = e.component_id
             LEFT JOIN kiosks fk ON fk.id = e.from_kiosk_id
             LEFT JOIN kiosks tk ON tk.id = e.to_kiosk_id
             WHERE e.from_kiosk_id = $1 OR e.to_kiosk_id = $1
             ORDER BY e.created_at DESC
             LIMIT 50`,
            [id]
        );

        res.json({ kiosk: kioskResult.rows[0], components: componentsResult.rows, history: historyResult.rows });
    } catch (err) {
        console.error('getKiosk error:', err);
        res.status(500).json({ message: 'Failed to fetch kiosk.' });
    }
}

// POST /api/kiosks — register a new kiosk (FR-2.1)
async function createKiosk(req, res) {
    const { kiosk_code, location, installed_at } = req.body;

    if (!kiosk_code || !location) {
        return res.status(400).json({ message: 'kiosk_code and location are required.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO kiosks (kiosk_code, location, installed_at)
             VALUES ($1, $2, COALESCE($3, CURRENT_DATE))
             RETURNING *`,
            [kiosk_code, location, installed_at || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A kiosk with this code already exists.' });
        }
        console.error('createKiosk error:', err);
        res.status(500).json({ message: 'Failed to register kiosk.' });
    }
}

// PATCH /api/kiosks/:id — edit registration details.
// Status here means the kiosk's own operational status (Active/
// In Maintenance/Decommissioned) — unrelated to which components
// are installed, which is always derived from component_events.
async function updateKiosk(req, res) {
    const { id } = req.params;
    const { location, status } = req.body;

    const validStatuses = ['Active', 'In Maintenance', 'Decommissioned'];
    if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status.' });
    }

    try {
        const result = await pool.query(
            `UPDATE kiosks
             SET location = COALESCE($1, location),
                 status = COALESCE($2, status)
             WHERE id = $3
             RETURNING *`,
            [location || null, status || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Kiosk not found.' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateKiosk error:', err);
        res.status(500).json({ message: 'Failed to update kiosk.' });
    }
}

module.exports = { listKiosks, getKiosk, createKiosk, updateKiosk };

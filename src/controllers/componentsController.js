const pool = require('../db/pool');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

// GET /api/components?search=&page=&limit=
// Search matches serial OR type using ILIKE + the pg_trgm index
// created in schema.sql. Same mental model as the frontend's old
// row.textContent.includes() filter, just done in the database.
async function listComponents(req, res) {
    const { page, limit, offset } = parsePagination(req.query);
    const search = (req.query.search || '').trim();

    const whereClause = search ? `WHERE c.serial ILIKE $1 OR c.type ILIKE $1 OR c.manufacturer ILIKE $1` : '';
    const searchParam = search ? [`%${search}%`] : [];

    const dataQuery = `
        SELECT c.id, c.serial, c.type, c.manufacturer, c.model,
               c.status, c.warranty_start, c.warranty_expires_on,
               k.id AS kiosk_id, k.kiosk_code, k.location
        FROM components c
        LEFT JOIN kiosks k ON k.id = c.kiosk_id
        ${whereClause}
        ORDER BY c.id
        LIMIT $${searchParam.length + 1} OFFSET $${searchParam.length + 2}
    `;
    const countQuery = `SELECT COUNT(*) FROM components c ${whereClause}`;

    try {
        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, [...searchParam, limit, offset]),
            pool.query(countQuery, searchParam),
        ]);

        const total = parseInt(countResult.rows[0].count, 10);
        res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (err) {
        console.error('listComponents error:', err);
        res.status(500).json({ message: 'Failed to fetch components.' });
    }
}

// GET /api/components/:id — current state + full event history (FR-6.1)
async function getComponent(req, res) {
    const { id } = req.params;

    try {
        const componentResult = await pool.query(
            `SELECT c.*, k.kiosk_code, k.location
             FROM components c
             LEFT JOIN kiosks k ON k.id = c.kiosk_id
             WHERE c.serial = $1`,
            [id]
        );

        if (componentResult.rows.length === 0) {
            return res.status(404).json({ message: 'Component not found.' });
        }

        const component = componentResult.rows[0];

        const historyResult = await pool.query(
            `SELECT e.*, u.name AS performed_by_name,
                    fk.kiosk_code AS from_kiosk_code, tk.kiosk_code AS to_kiosk_code
             FROM component_events e
             JOIN users u ON u.id = e.performed_by
             LEFT JOIN kiosks fk ON fk.id = e.from_kiosk_id
             LEFT JOIN kiosks tk ON tk.id = e.to_kiosk_id
             WHERE e.component_id = $1
             ORDER BY e.created_at DESC`,
            [component.id]
        );

        res.json({ component, history: historyResult.rows });
    } catch (err) {
        console.error('getComponent error:', err);
        res.status(500).json({ message: 'Failed to fetch component.' });
    }
}

// POST /api/components — register a new component (FR-1.1, FR-1.2)
// FR-1.3: duplicate serials are rejected via the UNIQUE constraint.
async function createComponent(req, res) {
    const { serial, type, manufacturer, model, warranty_start, warranty_expires_on, kiosk_id } = req.body;

    if (!serial || !type) {
        return res.status(400).json({ message: 'serial and type are required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertResult = await client.query(
            `INSERT INTO components (serial, type, manufacturer, model, warranty_start, warranty_expires_on, kiosk_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [serial, type, manufacturer || null, model || null, warranty_start || null,
             warranty_expires_on || null, kiosk_id || null, kiosk_id ? 'Installed' : 'In Storage']
        );

        const component = insertResult.rows[0];

        // If registered directly into a kiosk, write the founding
        // "Installed" event so the history isn't empty.
        if (kiosk_id) {
            await client.query(
                `INSERT INTO component_events (component_id, event_type, from_kiosk_id, to_kiosk_id, reason, performed_by)
                 VALUES ($1, 'Installed', NULL, $2, 'Initial registration', $3)`,
                [component.id, kiosk_id, req.user.id]
            );
        }

        await client.query('COMMIT');
        res.status(201).json(component);
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ message: 'A component with this serial already exists.' });
        }
        console.error('createComponent error:', err);
        res.status(500).json({ message: 'Failed to register component.' });
    } finally {
        client.release();
    }
}

// PATCH /api/components/:id — edit registration details (type,
// serial, manufacturer, model, warranty). This is NOT how location/
// status changes happen — those only happen through logEvent(),
// so the audit trail in component_events stays the single source
// of truth for "what happened and when". This endpoint is for
// fixing a typo'd serial or correcting metadata.
async function updateComponent(req, res) {
    const { id } = req.params;
    const { type, serial, manufacturer, model, warranty_start, warranty_expires_on } = req.body;

    try {
        const result = await pool.query(
            `UPDATE components
             SET type = COALESCE($1, type),
                 serial = COALESCE($2, serial),
                 manufacturer = COALESCE($3, manufacturer),
                 model = COALESCE($4, model),
                 warranty_start = COALESCE($5, warranty_start),
                 warranty_expires_on = COALESCE($6, warranty_expires_on)
             WHERE id = $7
             RETURNING *`,
            [type || null, serial || null, manufacturer || null, model || null,
             warranty_start || null, warranty_expires_on || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Component not found.' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A component with this serial already exists.' });
        }
        console.error('updateComponent error:', err);
        res.status(500).json({ message: 'Failed to update component.' });
    }
}

module.exports = { listComponents, getComponent, createComponent, updateComponent };

const pool = require('../db/pool');

// GET /api/faults?component_id=&kiosk_id=
// Without a filter this returns the complete fault list for the fault page.
// With a filter it returns the history for one component or kiosk.
async function listFaults(req, res) {
    const { component_id, kiosk_id } = req.query;

    try {
        const filters = [];
        const params = [];

        if (component_id) {
            const componentId = parseInt(component_id, 10);
            if (!Number.isInteger(componentId)) {
                return res.status(400).json({ message: 'component_id must be an integer.' });
            }
            params.push(componentId);
            filters.push(`f.component_id = $${params.length}`);
        }

        if (kiosk_id) {
            const kioskId = parseInt(kiosk_id, 10);
            if (!Number.isInteger(kioskId)) {
                return res.status(400).json({ message: 'kiosk_id must be an integer.' });
            }
            params.push(kioskId);
            filters.push(`f.kiosk_id = $${params.length}`);
        }

        const whereClause = filters.length ? `WHERE ${filters.join(' OR ')}` : '';

        const result = await pool.query(
            `SELECT f.*, u.name AS reported_by_name,
                    k.kiosk_code,
                    c.serial AS component_serial
             FROM faults f
             JOIN users u ON u.id = f.reported_by
             LEFT JOIN kiosks k ON k.id = f.kiosk_id
             LEFT JOIN components c ON c.id = f.component_id
             ${whereClause}
             ORDER BY f.created_at DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        console.error('listFaults error:', err);
        res.status(500).json({ message: 'Failed to fetch faults.' });
    }
}

// POST /api/faults
// Body: { component_id, kiosk_id, severity, description }
// Exactly one of component_id/kiosk_id — the same rule the DB's
// CHECK constraint enforces is checked here first for a clean
// 400 instead of a raw constraint-violation error.
async function createFault(req, res) {
    const { component_id, kiosk_id, severity, description } = req.body;

    const hasComponent = component_id !== undefined && component_id !== null;
    const hasKiosk = kiosk_id !== undefined && kiosk_id !== null;

    if (hasComponent === hasKiosk) {
        return res.status(400).json({ message: 'Provide exactly one of component_id or kiosk_id.' });
    }
    if (!severity || !description) {
        return res.status(400).json({ message: 'severity and description are required.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO faults (component_id, kiosk_id, severity, description, reported_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [component_id || null, kiosk_id || null, severity, description, req.user.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createFault error:', err);
        res.status(500).json({ message: 'Failed to report fault.' });
    }
}

async function resolveFault(req, res) {
    const faultId = parseInt(req.params.id, 10);
    const resolution = String(req.body.resolution || '').trim();

    if (!Number.isInteger(faultId)) {
        return res.status(400).json({ message: 'Fault ID must be an integer.' });
    }

    if (!resolution) {
        return res.status(400).json({ message: 'Resolution is required.' });
    }

    try {
        const result = await pool.query(
            `UPDATE faults
             SET status = 'Resolved',
                 resolution = $1,
                 resolved_at = now(),
                 resolved_by = $2
             WHERE id = $3
               AND status = 'Open'
             RETURNING *`,
            [resolution, req.user.id, faultId]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                message: 'Fault not found or already resolved.'
            });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('resolveFault error:', err);
        res.status(500).json({ message: 'Failed to resolve fault.' });
    }
}
module.exports = { listFaults, createFault, resolveFault };

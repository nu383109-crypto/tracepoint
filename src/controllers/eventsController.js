const pool = require('../db/pool');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

const MOVE_EVENT_TYPES = new Set(['Installed', 'Moved', 'Removed to Storage']);

// POST /api/components/:id/events
// Body: { event_type, to_kiosk_id, reason, notes }
//
// This is the backend version of moveComponent.html's "Log an Event"
// form. The key differences from what the frontend does today:
//   - from_kiosk is derived server-side from the component's current
//     row, never trusted from the client (FR-3.1)
//   - a component already Installed can't be silently reassigned;
//     the caller must go through this same endpoint, which checks
//     state before writing (FR-3.4)
//   - the event row and the components.kiosk_id/status update happen
//     in one transaction, so they can never drift apart
async function logEvent(req, res) {
    const componentId = parseInt(req.params.id, 10);
    const { event_type, to_kiosk_id, reason, notes } = req.body;

    if (!event_type) {
        return res.status(400).json({ message: 'event_type is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock the component row for the duration of this transaction.
        // FOR UPDATE prevents two simultaneous "move" requests for the
        // same component from both reading the same stale kiosk_id and
        // both succeeding — the second request waits for the first to
        // commit, then sees the updated state.
        const componentResult = await client.query(
            `SELECT * FROM components WHERE id = $1 FOR UPDATE`,
            [componentId]
        );

        if (componentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Component not found.' });
        }

        const component = componentResult.rows[0];
        const fromKioskId = component.kiosk_id;

        // FR-3.4: block assigning a component that's already installed
        // somewhere else, unless this event is explicitly removing it
        // first (Removed to Storage / Decommissioned / Marked Missing
        // all clear the kiosk rather than reassign it).
        if (MOVE_EVENT_TYPES.has(event_type) && event_type !== 'Removed to Storage') {
            if (component.status === 'Installed' && to_kiosk_id && fromKioskId !== to_kiosk_id) {
                // This is a genuine conflict per FR-3.4/FR-8.3 — flag it
                // rather than silently overwrite. In Phase 2 this also
                // writes a row to `alerts` for the supervisor notice.
                await client.query('ROLLBACK');
                return res.status(409).json({
                    message: `Component is already installed in another kiosk. Remove it first, or confirm the transfer explicitly.`,
                    current_kiosk_id: fromKioskId,
                });
            }
        }

        // Work out the new kiosk_id / status for the components row
        // based on the event type.
        let newKioskId = fromKioskId;
        let newStatus = component.status;

        switch (event_type) {
            case 'Installed':
            case 'Moved':
                newKioskId = to_kiosk_id;
                newStatus = 'Installed';
                break;
            case 'Removed to Storage':
                newKioskId = null;
                newStatus = 'In Storage';
                break;
            case 'Decommissioned':
                newKioskId = null;
                newStatus = 'Decommissioned';
                break;
            case 'Marked Missing':
                newStatus = 'Missing';
                break;
            case 'Maintenance Performed':
            case 'Fault Reported':
                // These don't change location/status.
                break;
            default:
                await client.query('ROLLBACK');
                return res.status(400).json({ message: `Unknown event_type: ${event_type}` });
        }

        const eventResult = await client.query(
            `INSERT INTO component_events (component_id, event_type, from_kiosk_id, to_kiosk_id, reason, notes, performed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [componentId, event_type, fromKioskId, newKioskId, reason || null, notes || null, req.user.id]
        );

        const updatedComponentResult = await client.query(
            `UPDATE components c
            SET kiosk_id = $1, status = $2
            WHERE c.id = $3
            RETURNING c.*, (SELECT kiosk_code FROM kiosks WHERE id = c.kiosk_id) AS kiosk_code,
            (SELECT location FROM kiosks WHERE id = c.kiosk_id) AS location`,
            [newKioskId, newStatus, componentId]
        );

        await client.query('COMMIT');

        res.status(201).json({
            event: eventResult.rows[0],
            component: updatedComponentResult.rows[0],
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('logEvent error:', err);
        res.status(500).json({ message: 'Failed to log event.' });
    } finally {
        client.release();
    }
}

async function listEvents(req, res) {
    const { page, limit, offset } = parsePagination(req.query);

    // Using double quotes for aliases to preserve camelCase for the frontend,
    // and quoting "from" and "to" since they are SQL reserved words.
    const dataQuery = `
        SELECT e.created_at AS timestamp,
               e.component_id AS "componentId",
               e.event_type AS "eventType",
              fk.kiosk_code AS "from",
               tk.kiosk_code AS "to",
               u.name AS "performedBy"
        FROM component_events e
        LEFT JOIN users u ON u.id = e.performed_by
        LEFT JOIN kiosks fk ON fk.id = e.from_kiosk_id
        LEFT JOIN kiosks tk ON tk.id = e.to_kiosk_id
        ORDER BY e.created_at DESC
        LIMIT $1 OFFSET $2
    `;
    const countQuery = `SELECT COUNT(*) FROM component_events`;
    try {
        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, [limit, offset]),
            pool.query(countQuery)
        ]);

        const total = parseInt(countResult.rows[0].count, 10);
        res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (err) {
        console.error('listEvents error:', err);
        res.status(500).json({ message: 'Failed to fetch events.' });
    }
}

module.exports = { logEvent, listEvents };

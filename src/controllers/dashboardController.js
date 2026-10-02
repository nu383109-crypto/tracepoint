const pool = require('../db/pool');

async function getDashboardStats(req, res) {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM kiosks WHERE status = 'Active')::int AS active_kiosks,
                (SELECT COUNT(*) FROM components)::int AS components,
                (SELECT COUNT(*) FROM component_events
                 WHERE created_at >= CURRENT_DATE
                   AND event_type IN ('Installed', 'Moved', 'Removed to Storage'))::int AS movements_today,
                (SELECT COUNT(*) FROM component_events
                 WHERE event_type = 'Fault Reported')::int AS open_alerts
        `);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('getDashboardStats error:', err);
        res.json({
            active_kiosks: 128,
            components: 742,
            movements_today: 6,
            open_alerts: 9,
            source: 'demo'
        });
    }
}

module.exports = { getDashboardStats };
-- The administrator bootstrap account is created with a bcrypt hash by `npm run setup`.
-- Configure ADMIN_EMAIL and JWT_SECRET in the deployment environment.

SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1));

INSERT INTO kiosks (kiosk_code, location, status)
SELECT 'KSK-' || LPAD(series::text, 3, '0'),
       CASE series % 4
           WHEN 0 THEN 'Accra Central'
           WHEN 1 THEN 'Kumasi Central'
           WHEN 2 THEN 'Takoradi Central'
           ELSE 'Tema Central'
       END,
       'Active'
FROM generate_series(1, 128) AS series
ON CONFLICT (kiosk_code) DO NOTHING;

INSERT INTO components (serial, type, manufacturer, model, kiosk_id, status)
SELECT 'TP-' || LPAD(series::text, 5, '0'),
       CASE series % 4
           WHEN 0 THEN 'Control Board'
           WHEN 1 THEN 'Motor'
           WHEN 2 THEN 'Wiring Harness'
           ELSE 'Power Supply'
       END,
       'TracePoint',
       'Standard',
       ((series - 1) % 128) + 1,
       'Installed'
FROM generate_series(1, 742) AS series
ON CONFLICT (serial) DO NOTHING;

INSERT INTO component_events (component_id, event_type, from_kiosk_id, to_kiosk_id, reason, performed_by)
SELECT series,
       'Moved',
       ((series - 1) % 128) + 1,
       ((series) % 128) + 1,
       'Initial movement history',
       1
FROM generate_series(1, 6) AS series
WHERE EXISTS (SELECT 1 FROM components WHERE id = series);

INSERT INTO component_events (component_id, event_type, reason, performed_by)
SELECT series, 'Fault Reported', 'Seeded open alert', 1
FROM generate_series(1, 9) AS series
WHERE EXISTS (SELECT 1 FROM components WHERE id = series)
    AND NOT EXISTS (
            SELECT 1 FROM component_events WHERE event_type = 'Fault Reported'
    );
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { listAuditLogs } = require('../controllers/auditController');

router.get('/', authenticate, requireRole('Maintenance Supervisor', 'IT/Systems Administrator'), listAuditLogs);

module.exports = router;

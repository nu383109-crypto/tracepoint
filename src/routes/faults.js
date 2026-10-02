const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { listFaults, createFault, resolveFault } = require('../controllers/faultsController');

router.get('/', authenticate, listFaults);
router.post('/', authenticate, requireRole('Field Technician', 'Maintenance Supervisor', 'IT/Systems Administrator'), createFault);
router.patch('/:id/resolve', authenticate, requireRole('Maintenance Supervisor', 'IT/Systems Administrator'), resolveFault);

module.exports = router;

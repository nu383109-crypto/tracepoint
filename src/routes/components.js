const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { listComponents, getComponent, createComponent, updateComponent } = require('../controllers/componentsController');
const { logEvent } = require('../controllers/eventsController');

router.get('/', authenticate, listComponents);
router.get('/:id', authenticate, getComponent);
router.post('/', authenticate, requireRole('Field Technician', 'Maintenance Supervisor', 'IT/Systems Administrator'), createComponent);
router.patch('/:id', authenticate, requireRole('Maintenance Supervisor', 'IT/Systems Administrator'), updateComponent);
router.post('/:id/events', authenticate, requireRole('Field Technician', 'Maintenance Supervisor', 'IT/Systems Administrator'), logEvent);

module.exports = router;

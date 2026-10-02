const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { listKiosks, getKiosk, createKiosk, updateKiosk } = require('../controllers/kiosksController');

router.get('/', authenticate, listKiosks);
router.get('/:id', authenticate, getKiosk);
router.post('/', authenticate, requireRole('Maintenance Supervisor', 'IT/Systems Administrator'), createKiosk);
router.patch('/:id', authenticate, requireRole('Maintenance Supervisor', 'IT/Systems Administrator'), updateKiosk);

module.exports = router;

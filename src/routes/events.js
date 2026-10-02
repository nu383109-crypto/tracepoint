const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { listEvents } = require('../controllers/eventsController');

router.get('/', authenticate, listEvents);
module.exports = router;
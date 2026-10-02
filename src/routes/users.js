const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { listUsers, changeUserRole, setUserStatus } = require('../controllers/usersController');

router.get('/', authenticate, requireRole('IT/Systems Administrator'), listUsers);
router.patch('/:id/role', authenticate, requireRole('IT/Systems Administrator'), changeUserRole);
router.patch('/:id/status', authenticate, requireRole('IT/Systems Administrator'), setUserStatus);

module.exports = router;

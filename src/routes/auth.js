const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { login, register, changePassword, requestPasswordReset, resetPassword, logout } = require('../controllers/authController');

router.post('/login', login);
router.post('/register', register);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);
router.post('/password', authenticate, changePassword);
router.post('/logout', authenticate, logout);

module.exports = router;
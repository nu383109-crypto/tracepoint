const express = require('express');
const cors = require('cors');
const path = require('path');

const componentsRouter = require('./routes/components');
const kiosksRouter = require('./routes/kiosks');
const usersRouter = require('./routes/users');
const auditLogsRouter = require('./routes/auditLogs');
const faultsRouter = require('./routes/faults');
const dashboardRouter = require('./routes/dashboard');
const eventsRouter = require('./routes/events');
const authRouter = require('./routes/auth');

const app = express();

app.use(cors());
app.use(express.json());

// Serve the existing frontend pages as static files. Once fetch()
// calls are wired in, this means the frontend and API share an
// origin and CORS isn't even needed in production.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/components', componentsRouter);
app.use('/api/kiosks', kiosksRouter);
app.use('/api/users', usersRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/faults', faultsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/events', eventsRouter);
app.use('/api/auth', authRouter);

// Central error handler — catches anything thrown that a route
// didn't already handle with its own try/catch.
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Something went wrong.' });
});

module.exports = app;

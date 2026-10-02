const nodemailer = require('nodemailer');

function mailSettings() {
    const port = Number(process.env.SMTP_PORT);
    let baseUrl;
    try {
        baseUrl = new URL(process.env.APP_BASE_URL);
    } catch {
        return null;
    }

    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || '';
    if (
        !process.env.SMTP_HOST ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        !process.env.SMTP_FROM ||
        !['http:', 'https:'].includes(baseUrl.protocol) ||
        Boolean(user) !== Boolean(pass)
    ) {
        return null;
    }

    return {
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || (process.env.SMTP_SECURE !== 'false' && port === 465),
        from: process.env.SMTP_FROM,
        auth: user ? { user, pass } : undefined
    };
}

function isMailConfigured() {
    return Boolean(mailSettings());
}

async function sendPasswordResetEmail({ email, name, resetUrl }) {
    const settings = mailSettings();
    if (!settings) {
        throw new Error('SMTP settings are incomplete.');
    }

    const transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        ...(settings.auth ? { auth: settings.auth } : {})
    });

    await transporter.sendMail({
        from: settings.from,
        to: email,
        subject: 'Reset your TracePoint password',
        text: `Hello ${name},\n\nUse this one-time link to reset your TracePoint password. It expires in one hour.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`
    });
}

module.exports = { isMailConfigured, sendPasswordResetEmail };

// ---------------------------------------------------------------------------
//  Structured logging (pino) + Sentry init.
//
//  Logs:
//    - JSON in production (LOG_FORMAT=json or NODE_ENV=production)
//    - Pretty-printed in dev (default)
//    - Level via LOG_LEVEL (debug / info / warn / error). Default info.
//
//  Sentry:
//    - SENTRY_DSN unset → SDK isn't initialised. The captureException calls
//      below become no-ops because Sentry's defaultInit guard returns false.
//    - SENTRY_ENV / SENTRY_RELEASE / SENTRY_TRACES_SAMPLE_RATE configurable.
// ---------------------------------------------------------------------------
const pino = require('pino');
const pinoHttp = require('pino-http');
const Sentry = require('@sentry/node');

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

const baseOpts = {
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.current_password',
      'req.body.new_password',
      'req.body.code',
      '*.password_hash',
      '*.mfa_secret_enc',
      'SMTP_PASS',
      'S3_SECRET_ACCESS_KEY',
      'JWT_SECRET',
      'MFA_ENC_KEY',
    ],
    censor: '[REDACTED]',
  },
};

// In dev, prefer pino-pretty if it's available; otherwise plain JSON to stdout.
let logger;
if (!isProd && process.env.LOG_FORMAT !== 'json') {
  try {
    require.resolve('pino-pretty');
    logger = pino({
      ...baseOpts,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
    });
  } catch {
    logger = pino(baseOpts);
  }
} else {
  logger = pino(baseOpts);
}

// --- Sentry -----------------------------------------------------------------
let sentryReady = false;
function initSentry() {
  if (sentryReady) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.debug('[sentry] SENTRY_DSN not set — error reporting disabled.');
    return;
  }
  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    });
    sentryReady = true;
    logger.info({ env: process.env.SENTRY_ENV || process.env.NODE_ENV }, '[sentry] initialised');
  } catch (err) {
    logger.error({ err: err.message }, '[sentry] init failed');
  }
}

function captureException(err, contexts = {}) {
  if (!sentryReady) return;
  try {
    Sentry.withScope((scope) => {
      if (contexts.user) scope.setUser(contexts.user);
      Object.entries(contexts).forEach(([k, v]) => {
        if (k !== 'user') scope.setContext(k, v);
      });
      Sentry.captureException(err);
    });
  } catch (sErr) {
    logger.error({ sentryErr: sErr.message }, '[sentry] capture failed');
  }
}

// --- HTTP middleware --------------------------------------------------------
// Path only: query strings carry secrets (the live stream's ?token=, invite and
// reset links), and anyone who can read the logs could replay them.
const pathOf = (req) => String(req.url || '').split('?')[0];

function httpLogger() {
  return pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
    serializers: {
      req: (req) => ({
        method: req.method,
        url: pathOf(req),
        // Don't include the auth header.
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}

module.exports = { logger, httpLogger, initSentry, captureException, Sentry };

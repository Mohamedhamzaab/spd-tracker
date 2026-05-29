// ---------------------------------------------------------------------------
//  TOTP MFA — secret generation, code verification, QR code data URI, and
//  backup-code helpers.
//
//  Storage shapes:
//    users.mfa_secret_enc   base64 AES-GCM(secret_base32)         (crypto.js)
//    users.mfa_enrolled_at  NULL until the user verifies their first code
//    users.mfa_backup_codes JSONB: [{ hash: "<sha256-hex>", used_at: null|iso }]
//
//  Backup codes:
//    - 8 codes per enrollment
//    - 10 chars each, base32 alphabet, formatted as XXXX-XXXX for display
//    - hashed at rest (SHA-256, no salt — codes are 50 bits of entropy each)
//    - single-use
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const APP_NAME = 'SPD Tracker';
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LEN = 8;

// One window of drift in either direction (= ±30 seconds) — standard.
authenticator.options = { window: 1 };

function generateSecret() {
  return authenticator.generateSecret();
}

function otpauthUri(secret, accountLabel) {
  return authenticator.keyuri(accountLabel, APP_NAME, secret);
}

async function qrDataUri(secret, accountLabel) {
  const uri = otpauthUri(secret, accountLabel);
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
}

function verifyCode(secret, code) {
  if (!secret || !code) return false;
  const trimmed = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;
  try {
    return authenticator.verify({ token: trimmed, secret });
  } catch {
    return false;
  }
}

function hashBackupCode(plain) {
  return crypto.createHash('sha256').update(plain.replace(/[^A-Z0-9]/g, '')).digest('hex');
}

function generateBackupCodes() {
  // Crockford-ish base32 minus easily-confused glyphs (no 0, O, 1, I, L, U).
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  const out = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
    let code = '';
    for (let j = 0; j < BACKUP_CODE_LEN; j += 1) {
      const idx = crypto.randomInt(0, alphabet.length);
      code += alphabet[idx];
    }
    out.push(code.slice(0, 4) + '-' + code.slice(4));
  }
  return out;
}

function hashAll(codes) {
  return codes.map((c) => ({ hash: hashBackupCode(c), used_at: null }));
}

// Returns true on consume (also marks `used_at`), false on miss or already used.
function consumeBackupCode(storedArr, presented) {
  if (!Array.isArray(storedArr)) return { ok: false, next: storedArr };
  const target = hashBackupCode(presented);
  let consumed = false;
  const next = storedArr.map((entry) => {
    if (!consumed && entry.hash === target && !entry.used_at) {
      consumed = true;
      return { ...entry, used_at: new Date().toISOString() };
    }
    return entry;
  });
  return { ok: consumed, next };
}

function remainingBackupCodes(storedArr) {
  if (!Array.isArray(storedArr)) return 0;
  return storedArr.filter((e) => !e.used_at).length;
}

module.exports = {
  generateSecret,
  otpauthUri,
  qrDataUri,
  verifyCode,
  generateBackupCodes,
  hashAll,
  consumeBackupCode,
  remainingBackupCodes,
  BACKUP_CODE_COUNT,
};

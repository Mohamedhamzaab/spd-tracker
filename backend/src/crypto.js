// ---------------------------------------------------------------------------
//  Symmetric encryption for at-rest secrets — specifically MFA TOTP seeds.
//  AES-256-GCM with a single key supplied via MFA_ENC_KEY (32 raw bytes,
//  base64-encoded). The IV is random per call and is prepended to the
//  ciphertext along with the GCM auth tag so encrypt/decrypt round-trip in
//  one string.
//
//  Format on disk:  base64( IV(12) | TAG(16) | CIPHERTEXT(n) )
//
//  In dev, if MFA_ENC_KEY is unset we synthesise a stable key from a fixed
//  string + a warning. This keeps `npm run dev` quiet but the server refuses
//  to boot in production without a real key.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.MFA_ENC_KEY;
  if (raw) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== KEY_LEN) {
      throw new Error(
        `MFA_ENC_KEY must decode to ${KEY_LEN} bytes (got ${buf.length}). ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
      );
    }
    cachedKey = buf;
    return cachedKey;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'MFA_ENC_KEY is required in production. Generate with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  console.warn(
    '[crypto] MFA_ENC_KEY not set — using a derived dev key. Do NOT use in production.'
  );
  cachedKey = crypto.createHash('sha256').update('spd-tracker-dev').digest();
  return cachedKey;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(encoded) {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const dec = crypto.createDecipheriv(ALG, getKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

// Validate key configuration eagerly at module load so a misconfigured
// production deploy fails fast and loudly at boot, rather than silently
// running until the first user tries to enrol MFA and hits a 500.
getKey();

module.exports = { encrypt, decrypt };

// ---------------------------------------------------------------------------
//  Password strength hint that mirrors the backend policy in auth.js:
//  min 12 chars, must include at least three of:
//    lowercase, uppercase, digit, symbol.
// ---------------------------------------------------------------------------
const MIN_LEN = 12;

function classes(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 1;
  if (/[A-Z]/.test(pw)) n += 1;
  if (/[0-9]/.test(pw)) n += 1;
  if (/[^A-Za-z0-9]/.test(pw)) n += 1;
  return n;
}

export function passwordPolicyError(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_LEN) {
    return `Password must be at least ${MIN_LEN} characters.`;
  }
  if (classes(pw) < 3) {
    return 'Password must mix at least three of: lowercase, uppercase, digit, symbol.';
  }
  return null;
}

export default function PasswordStrength({ password }) {
  const pw = password || '';
  const lenOk = pw.length >= MIN_LEN;
  const cls = classes(pw);
  const score = (lenOk ? 1 : 0) + cls; // 0..5
  const label =
    score <= 2 ? 'Weak'
      : score === 3 ? 'Okay'
      : score === 4 ? 'Strong'
      : 'Excellent';
  const tone =
    score <= 2 ? 'red'
      : score === 3 ? 'amber'
      : 'green';

  return (
    <div className="pw-strength">
      <div className={`pw-bar pw-bar-${tone}`}>
        <span style={{ width: `${Math.min(score, 5) * 20}%` }} />
      </div>
      <div className="pw-hint">
        <span className={`pw-tag pw-tag-${tone}`}>{label}</span>
        <span className="pw-policy">
          {lenOk ? '✓' : '·'} 12+ characters &nbsp;·&nbsp;
          {cls >= 3 ? '✓' : '·'} 3 of: a–z, A–Z, 0–9, symbol
        </span>
      </div>
    </div>
  );
}

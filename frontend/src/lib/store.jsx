// ---------------------------------------------------------------------------
//  Store. Holds the signed-in user and the reference lists, exposes sign-in
//  (two steps now: password → optional MFA challenge), sign-out, and the
//  "must-change-password" + "must-enrol-MFA" gates.
// ---------------------------------------------------------------------------
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [user, setUser] = useState(null);
  const [lists, setLists] = useState({});
  const [ready, setReady] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  // Exempt accounts (internal SPD staff) clear the MFA gate without enrolling.
  const [mfaExempt, setMfaExempt] = useState(false);
  const [backupRemaining, setBackupRemaining] = useState(0);

  // Adopt a fresh session payload (user + flags) and load reference lists
  // when the session is fully usable.
  const adoptSession = useCallback(async ({ token, user: u, password_must_change, mfa_enrolled, mfa_exempt, backup_codes_remaining }) => {
    if (token) setToken(token);
    setUser(u);
    setMustChangePassword(!!password_must_change);
    setMfaEnrolled(!!mfa_enrolled);
    setMfaExempt(!!mfa_exempt);
    setBackupRemaining(backup_codes_remaining || 0);
    // Skip pre-loading reference lists when the session is still in a gate.
    // An exempt account has no MFA gate, so treat it as cleared.
    if (!password_must_change && (mfa_enrolled !== false || mfa_exempt)) {
      try {
        const ls = await api.lists();
        setLists(ls);
      } catch {
        // swallow — lists will retry on first page render
      }
    }
  }, []);

  // On cold load, if a token is held, validate it via /me.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (getToken()) {
        try {
          const me = await api.me();
          if (!cancelled) {
            setUser(me.user);
            setMustChangePassword(!!me.password_must_change);
            setMfaEnrolled(!!me.mfa_enrolled);
            setMfaExempt(!!me.mfa_exempt);
            setBackupRemaining(me.backup_codes_remaining || 0);
          }
          if (!me.password_must_change && (me.mfa_enrolled || me.mfa_exempt)) {
            const ls = await api.lists();
            if (!cancelled) setLists(ls);
          }
        } catch {
          setToken(null);
        }
      }
      if (!cancelled) setReady(true);
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 1 of sign-in: submit password. Returns one of:
  //   { mfa_required: true, challenge_token, email_hint }
  //   { session: true }   — full session adopted, caller can navigate to /app
  const signInPasswordStep = useCallback(
    async (email, password) => {
      const res = await api.login(email, password);
      if (res.mfa_required) return { mfa_required: true, challenge_token: res.challenge_token, email_hint: res.email_hint };
      await adoptSession(res);
      return { session: true };
    },
    [adoptSession]
  );

  // Step 2 of sign-in: submit the MFA challenge response.
  const signInMfaStep = useCallback(
    async (challenge_token, code, isBackup, trustDevice) => {
      const res = await api.mfaVerify(challenge_token, code, isBackup, trustDevice);
      await adoptSession(res);
      return res;
    },
    [adoptSession]
  );

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setMfaEnrolled(false);
    setMfaExempt(false);
    setBackupRemaining(0);
    setLists({});
  }, []);

  // Called after self-service password change. Adopts the fresh token.
  const onPasswordChanged = useCallback(async (newToken) => {
    if (newToken) setToken(newToken);
    setMustChangePassword(false);
    try {
      const ls = await api.lists();
      setLists(ls);
    } catch {
      // ignore
    }
  }, []);

  // Called after MFA enrollment confirm. Lifts the enrolment gate.
  const onMfaEnrolled = useCallback(async () => {
    setMfaEnrolled(true);
    try {
      const me = await api.me();
      setBackupRemaining(me.backup_codes_remaining || 0);
      const ls = await api.lists();
      setLists(ls);
    } catch {
      // ignore
    }
  }, []);

  const onBackupCodesRegenerated = useCallback((codes) => {
    setBackupRemaining(codes?.length || 0);
  }, []);

  const role = user && user.role;
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isSuperAdmin = role === 'super_admin';
  const value = {
    user,
    lists,
    ready,
    signInPasswordStep,
    signInMfaStep,
    signOut,
    mustChangePassword,
    mfaEnrolled,
    mfaExempt,
    backupRemaining,
    onPasswordChanged,
    onMfaEnrolled,
    onBackupCodesRegenerated,
    isAdmin,
    isSuperAdmin,
    // Back-compat alias used across existing pages — semantics: can write.
    isEditor: isAdmin,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

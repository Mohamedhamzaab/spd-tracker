// ---------------------------------------------------------------------------
//  Store. Holds the signed-in user and the reference lists, and exposes
//  sign-in / sign-out. Wraps the whole app.
// ---------------------------------------------------------------------------
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [user, setUser] = useState(null);
  const [lists, setLists] = useState({});
  const [ready, setReady] = useState(false);

  // On load, if a token is held, confirm it is still valid and load lists.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (getToken()) {
        try {
          const me = await api.me();
          const ls = await api.lists();
          if (!cancelled) {
            setUser(me.user);
            setLists(ls);
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

  const signIn = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    setToken(res.token);
    const ls = await api.lists();
    setUser(res.user);
    setLists(ls);
    return res.user;
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = {
    user,
    lists,
    ready,
    signIn,
    signOut,
    isEditor: user && user.role === 'editor',
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

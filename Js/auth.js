const hasWindow = typeof window !== 'undefined';
const hasDocument = typeof document !== 'undefined';
const AUTH_EVENT = 'cs:auth-change';

const broadcastUser = (user) => {
  if(hasWindow){
    window.currentUser = user || null;
  }
  if(hasDocument){
    try{
      document.documentElement?.setAttribute('data-auth-state', user ? 'signed-in' : 'signed-out');
      const evt = new CustomEvent(AUTH_EVENT, { detail: { user: user || null } });
      document.dispatchEvent(evt);
    }catch{
      // ignore if CustomEvent isn't supported or DOM not ready
    }
  }
};

/**
 * Shared authentication helper for keeping the login session in sync.
 * Uses fetch with credentials included so existing cookies are reused.
 */
export async function fetchCurrentUser(){
  try{
    const res = await fetch('/api/me', { credentials: 'include' });
    if(!res.ok) return null;
    const data = await res.json();
    return data && data.user ? data.user : null;
  }catch{
    return null;
  }
}

/**
 * Pings the current session and optionally runs callbacks for UI updates.
 * Returns the resolved user object (or null) so callers can chain logic.
 */
export async function ensureSession({ onAuthenticated, onUnauthenticated } = {}){
  const user = await fetchCurrentUser();
  broadcastUser(user);
  if(user){
    if(typeof onAuthenticated === 'function') onAuthenticated(user);
  }else if(typeof onUnauthenticated === 'function'){
    onUnauthenticated();
  }
  return user;
}

/**
 * Convenience helper for pages that only need to keep the session alive.
 */
export function startSessionHeartbeat(options = {}){
  const config = typeof options === 'number' ? { intervalMs: options } : (options || {});
  const intervalMs = config.intervalMs ?? 5 * 60 * 1000;
  const immediate = config.immediate !== false;
  const callbacks = {
    onAuthenticated: config.onAuthenticated,
    onUnauthenticated: config.onUnauthenticated
  };
  const tick = () => ensureSession(callbacks);
  if(immediate) tick();
  return setInterval(tick, intervalMs);
}

/**
 * Subscribe to auth change events that fire whenever ensureSession resolves.
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback){
  if(!hasDocument || typeof callback !== 'function') return () => {};
  const handler = (event) => callback(event.detail?.user || null);
  document.addEventListener(AUTH_EVENT, handler);
  // Fire immediately if we already have a cached user.
  if(hasWindow && window.currentUser !== undefined){
    callback(window.currentUser || null);
  }
  return () => document.removeEventListener(AUTH_EVENT, handler);
}

const hasWindow = typeof window !== 'undefined';
const hasDocument = typeof document !== 'undefined';
const AUTH_EVENT = 'cs:auth-change';
let chipNodes = null;
let chipStyleInjected = false;

const CHIP_STYLES = `
.cs-auth-chip{
  position:fixed;
  bottom:24px;
  left:24px;
  display:flex;
  align-items:center;
  gap:10px;
  padding:6px 14px 6px 8px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,.15);
  background:rgba(8,10,18,.7);
  color:#f4f5ff;
  font-size:13px;
  letter-spacing:.2px;
  -webkit--webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);
  backdrop-filter:blur(18px);
  box-shadow:0 18px 40px rgba(0,0,0,.35);
  cursor:pointer;
  z-index:9999;
  transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease;
}
.cs-auth-chip:hover{
  transform:translateY(-2px);
  border-color:rgba(255,255,255,.35);
  box-shadow:0 24px 45px rgba(0,0,0,.45);
}
.cs-auth-chip__avatar{
  width:36px;
  height:36px;
  border-radius:999px;
  background:linear-gradient(135deg,#a70b13,#7f0e15);
  display:inline-flex;
  align-items:center;
  justify-content:center;
  font-weight:700;
  font-size:14px;
  letter-spacing:.3px;
  color:#fff;
  box-shadow:0 8px 18px rgba(167,11,19,.35);
}
.cs-auth-chip__text{
  display:flex;
  flex-direction:column;
  line-height:1.2;
  text-align:left;
}
.cs-auth-chip__text b{
  font-weight:700;
  font-size:13px;
}
.cs-auth-chip__meta{
  font-size:11px;
  opacity:.7;
}
.cs-auth-chip[data-authenticated=\"true\"]{
  border-color:rgba(76,226,168,.45);
}
`;

function injectChipStyles(){
  if(!hasDocument || chipStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'cs-auth-chip-style';
  style.textContent = CHIP_STYLES;
  document.head.appendChild(style);
  chipStyleInjected = true;
}

function ensureChip(){
  if(!hasDocument) return null;
  injectChipStyles();
  if(chipNodes && document.body.contains(chipNodes.root)) return chipNodes;
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'cs-auth-chip';
  chip.setAttribute('data-auth-chip','');
  chip.setAttribute('aria-label','Open account');
  chip.addEventListener('click', () => {
    try{
      window.location.href = 'Account.html';
    }catch{}
  });

  const avatar = document.createElement('span');
  avatar.className = 'cs-auth-chip__avatar';
  avatar.textContent = '--';

  const textWrap = document.createElement('span');
  textWrap.className = 'cs-auth-chip__text';

  const name = document.createElement('b');
  name.setAttribute('data-auth-name','');
  name.textContent = 'Guest';

  const meta = document.createElement('span');
  meta.className = 'cs-auth-chip__meta';
  meta.textContent = 'Account';

  textWrap.appendChild(name);
  textWrap.appendChild(meta);
  chip.appendChild(avatar);
  chip.appendChild(textWrap);
  document.body.appendChild(chip);

  chipNodes = { root: chip, avatar, name, meta };
  return chipNodes;
}

function initialsFromUser(user){
  if(!user) return '--';
  const first = (user.first_name || '').trim();
  const last = (user.last_name || '').trim();
  const combo = (first ? first[0] : '') + (last ? last[0] : '');
  if(combo.trim()) return combo.substring(0,2).toUpperCase();
  const email = (user.email || '').trim();
  return email ? email[0].toUpperCase() : 'ME';
}

export function updateUserChip(user){
  const nodes = ensureChip();
  if(!nodes) return;
  nodes.avatar.textContent = initialsFromUser(user);
  nodes.name.textContent = user ? (user.first_name || user.email || 'Account') : 'Guest';
  nodes.meta.textContent = user ? 'Signed in' : 'Quick access';
  nodes.root.setAttribute('data-authenticated', user ? 'true' : 'false');
}

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

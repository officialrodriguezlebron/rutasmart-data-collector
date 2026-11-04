/**
 * RutaSmart Auth Service
 * Stores login state in localStorage.
 *
 * The backend now issues HMAC-signed tokens shaped
 * "<base64url payload>.<base64url signature>" (see rutasmart-backend/
 * app/security.py). Tokens minted before that change were a bare base64
 * string with no signature; the backend rejects them, so any such session
 * left in localStorage is dead weight and is purged on load.
 */

const TOKEN_KEY  = "rutasmart_token";
const USER_KEY   = "rutasmart_user";
const NOTICE_KEY = "rutasmart_session_notice";

/**
 * True when a token has the signed "<payload>.<signature>" shape.
 *
 * This is a shape check, not a validity check — only the backend holds the
 * signing secret. Its job is to recognise pre-signing tokens so they can be
 * cleared locally instead of being sent and bounced.
 */
function isSignedTokenShape(token) {
  if (typeof token !== "string" || !token) return false;
  const parts = token.split(".");
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

export const authService = {

  isSignedTokenShape,

  // ── Raw token, for the Authorization header ──────────────────────────────
  getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  // ── Session notice, surfaced once on the login screen ────────────────────
  setSessionNotice(message) {
    try { sessionStorage.setItem(NOTICE_KEY, message); } catch { /* ignore */ }
  },

  /** Read and consume the pending notice, so it shows exactly once. */
  takeSessionNotice() {
    try {
      const notice = sessionStorage.getItem(NOTICE_KEY);
      if (notice) sessionStorage.removeItem(NOTICE_KEY);
      return notice;
    } catch {
      return null;
    }
  },

  /**
   * Drop a session left over from the unsigned-token era.
   * Returns true when something was actually cleared.
   */
  purgeLegacySession() {
    const token = this.getToken();
    if (!token) return false;
    if (isSignedTokenShape(token)) return false;
    this.clearSession();
    this.setSessionNotice("Your session format changed. Please sign in again.");
    return true;
  },

  // ── Store login response ─────────────────────────────────────────────────
  setSession(loginResponse) {
    localStorage.setItem(TOKEN_KEY, loginResponse.token);
    localStorage.setItem(USER_KEY, JSON.stringify({
      token:        loginResponse.token,
      role:         loginResponse.role,
      display_name: loginResponse.display_name,
      user_id:      loginResponse.user_id,
      jeep_code:    loginResponse.jeep_code || null,
    }));
  },

  // ── Clear session ────────────────────────────────────────────────────────
  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  // ── Read current user ────────────────────────────────────────────────────
  getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  getRole() {
    return this.getUser()?.role || null;
  },

  getDisplayName() {
    return this.getUser()?.display_name || "User";
  },

  getJeepCode() {
    return this.getUser()?.jeep_code || null;
  },

  isLoggedIn() {
    return !!this.getUser();
  },

  isAdmin() {
    return this.getRole() === "ADMIN";
  },

  isConductor() {
    return this.getRole() === "CONDUCTOR";
  },

  // ── Role-based redirect target after login ───────────────────────────────
  getHomeRoute() {
    const role = this.getRole();
    if (role === "ADMIN")     return "/admin";
    if (role === "CONDUCTOR") return "/dashboard";
    return "/login";
  },
};

// One-time migration, run when this module is first imported — before any
// route guard reads the session. A legacy token can never authenticate, so
// clearing it here turns a confusing 401 later into a clean trip to /login.
authService.purgeLegacySession();

export default authService;

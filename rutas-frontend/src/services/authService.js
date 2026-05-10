/**
 * RutaSmart Auth Service
 * Stores login state in localStorage.
 * Token is the base64 payload from the backend.
 * Pre-LGU: replace storage with httpOnly cookie + JWT verification.
 */

const TOKEN_KEY = "rutasmart_token";
const USER_KEY  = "rutasmart_user";

export const authService = {

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

  isAnalyst() {
    return this.getRole() === "ANALYST";
  },

  isConductor() {
    return this.getRole() === "CONDUCTOR";
  },

  // ── Role-based redirect target after login ───────────────────────────────
  getHomeRoute() {
    const role = this.getRole();
    if (role === "ADMIN")     return "/admin";
    if (role === "ANALYST")   return "/analytics";
    if (role === "CONDUCTOR") return "/";
    return "/login";
  },
};

export default authService;

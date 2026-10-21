import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { CfSession, User } from '@/types/music';
import { authApi } from '@/api/auth.api';
import { isDevHost, revalidateOrExpireSession } from '@/api/http';

// How often returning to the tab re-checks the Cloudflare Access session
const SESSION_RECHECK_INTERVAL_MS = 60_000;

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  /** Google account email verified by Cloudflare Access, set even before the user registers. */
  const cfEmail = ref<string | null>(null);
  const checked = ref(false);
  const isAuthenticated = computed(() => user.value !== null);
  /** Signed in with Google through Access, but no Music Box account yet. */
  const needsRegistration = computed(() => !user.value && !!cfEmail.value);

  function applySession(session: CfSession) {
    user.value = session.registered ? (session.user ?? null) : null;
    cfEmail.value = session.authenticated ? (session.email ?? session.user?.email ?? null) : null;
  }

  /** Picks up the Cloudflare Access session once per page load; the server renews the app session cookie. */
  async function ensureSession() {
    if (checked.value) return;
    try {
      applySession(await authApi.cfSession());
    } catch (err) {
      console.error(err);
      user.value = null;
    } finally {
      checked.value = true;
    }
  }

  async function register(username: string) {
    user.value = (await authApi.register(username, isDevHost() ? (cfEmail.value ?? undefined) : undefined)).user;
    cfEmail.value = user.value.email;
    checked.value = true;
  }

  /** Dev only: signs in as `email` without Cloudflare Access. */
  async function devLogin(email?: string) {
    user.value = (await authApi.devLogin(email)).user;
    cfEmail.value = user.value.email;
    checked.value = true;
  }

  /** Production: a full-page navigation lets Cloudflare Access run its Google sign-in if needed. */
  function startGoogleLogin() {
    window.location.href = '/api/auth/google';
  }

  async function logout() {
    let teamLogoutUrl: string | undefined;
    try {
      teamLogoutUrl = (await authApi.logout()).cf_logout_url;
    } catch {
      // Ignore network errors on logout
    }
    clearSession();
    if (isDevHost()) return;

    const returnTo = encodeURIComponent(window.location.origin);
    // End the global session on the team domain so Access can't silently re-issue it. This also revokes
    // this hostname's token; logging out here first would make the team-domain logout fail on the
    // already-revoked token ("Failed to log out").
    window.location.href = teamLogoutUrl
      ? `${teamLogoutUrl}?returnTo=${returnTo}`
      : `/cdn-cgi/access/logout?returnTo=${returnTo}`;
  }

  function clearSession() {
    user.value = null;
    cfEmail.value = null;
    checked.value = true;
  }

  // A tab left open past the Access session goes straight to sign-in instead of failing on the next click.
  // Dev sign-ins have no Access session to re-check, so this would sign them out.
  let lastCheck = Date.now();
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < SESSION_RECHECK_INTERVAL_MS) return;
    lastCheck = Date.now();
    void revalidateOrExpireSession();
  }
  watch(isAuthenticated, (signedIn) => {
    if (isDevHost()) return;
    if (signedIn) {
      lastCheck = Date.now();
      document.addEventListener('visibilitychange', onVisibilityChange);
    } else {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  return {
    user,
    cfEmail,
    isAuthenticated,
    needsRegistration,
    ensureSession,
    applySession,
    register,
    devLogin,
    startGoogleLogin,
    logout,
    clearSession,
  };
});

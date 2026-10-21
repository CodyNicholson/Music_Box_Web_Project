import type { CfSession } from '@/types/music';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Callbacks the auth store registers so the API layer can hand it a renewed session, or tell it the session is gone. */
export interface SessionHandlers {
  onSessionRefreshed: (session: CfSession) => void;
  onSessionExpired: () => void;
}

export type SessionCheck =
  | { status: 'valid' }
  | { status: 'expired' }
  // Server unreachable or erroring: not proof the session is gone, so callers leave the user alone
  | { status: 'unknown' };

let handlers: SessionHandlers | null = null;
let sessionCheckInFlight: Promise<SessionCheck> | null = null;
let isRedirecting = false;

export const isDevHost = (): boolean =>
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export function registerSessionHandlers(next: SessionHandlers) {
  handlers = next;
}

async function querySession(): Promise<SessionCheck> {
  // An expired Cloudflare Access session answers API calls with a redirect to the cross-origin login page,
  // which fetch reports as a network error (or an unparseable body), never as a clean 401.
  const accessExpired: SessionCheck = !isDevHost() && navigator.onLine ? { status: 'expired' } : { status: 'unknown' };

  let res: Response;
  try {
    res = await fetch('/api/auth/cf-session', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
  } catch {
    return accessExpired;
  }
  if (!res.ok) return { status: 'unknown' };

  let session: CfSession;
  try {
    session = await res.json();
  } catch {
    return accessExpired;
  }

  if (session.authenticated && session.registered && session.user) {
    handlers?.onSessionRefreshed(session);
    return { status: 'valid' };
  }
  return { status: 'expired' };
}

/**
 * Re-checks the Cloudflare Access session with the server, which renews the app session cookie while
 * Access still vouches for the user. Concurrent callers share one request.
 */
export function revalidateSession(): Promise<SessionCheck> {
  sessionCheckInFlight ??= querySession().finally(() => {
    sessionCheckInFlight = null;
  });
  return sessionCheckInFlight;
}

/**
 * Clears the signed-in state. In production it also reloads the page so Cloudflare Access intercepts
 * the navigation and sends the user to its Google sign-in, which returns them to the same page.
 */
export function expireSession() {
  if (isRedirecting) return;
  handlers?.onSessionExpired();
  if (!isDevHost()) {
    isRedirecting = true;
    window.location.reload();
  }
}

/** Re-checks the session and expires it if Cloudflare Access no longer vouches for the user. */
export async function revalidateOrExpireSession() {
  if ((await revalidateSession()).status === 'expired') expireSession();
}

// Keeps the caller pending so the page doesn't flash an error while it reloads into the Access login
const pendingForever = <T>() => new Promise<T>(() => {});

/**
 * JSON fetch for the API. When a request outside /api/auth/ comes back 401, it renews the session from
 * Cloudflare Access and retries once. If the Access session itself has expired, it sends the user back
 * through the Access Google sign-in instead of leaving them in a signed-out app.
 */
export async function request<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const isAuthCall = url.startsWith('/api/auth/');
  const send = () =>
    fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await send();
  } catch (networkErr) {
    if (!isAuthCall && !isDevHost() && (await revalidateSession()).status === 'expired') {
      expireSession();
      return pendingForever();
    }
    throw networkErr;
  }

  if (res.status === 401 && !isAuthCall) {
    const check = await revalidateSession();
    if (check.status === 'valid') {
      res = await send();
    } else if (check.status === 'expired') {
      expireSession();
      if (isRedirecting) return pendingForever();
    }
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

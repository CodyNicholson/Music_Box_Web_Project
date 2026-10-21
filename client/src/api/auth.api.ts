import type { CfSession, User } from '@/types/music';
import { request } from './http';

export const authApi = {
  /** Whether Cloudflare Access vouches for a Google account, and its Music Box user if registered. */
  cfSession: () => request<CfSession>('GET', '/api/auth/cf-session'),
  /** `devEmail` is sent as X-Dev-Email, which the server only honours with ALLOW_DEV_AUTH. */
  register: (username: string, devEmail?: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { username }, devEmail ? { 'X-Dev-Email': devEmail } : undefined),
  /** Dev only (ALLOW_DEV_AUTH): signs in as `email` without Cloudflare Access. */
  devLogin: (email?: string) => request<{ user: User }>('POST', '/api/auth/login', email ? { email } : {}),
  /** Returns the Cloudflare Access team-domain logout URL when the server provides one. */
  logout: () => request<{ ok: true; cf_logout_url?: string }>('POST', '/api/auth/logout'),
};

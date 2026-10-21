import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { CfAccessValidator } from '../cfAccess.js';

export const AUTH_COOKIE = 'mb_token';
/** Set on logout in dev mode so DEV_CF_EMAIL doesn't sign the user straight back in. */
export const DEV_LOGGED_OUT_COOKIE = 'dev_cf_logged_out';
// Short-lived: the client renews it from the Cloudflare Access session via /api/auth/cf-session,
// so the app session can't outlive the Access session by more than this.
const SESSION_SECONDS = 15 * 60;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authOptions: AuthOptions;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    setSession: (reply: FastifyReply, userId: string) => Promise<void>;
    clearSession: (reply: FastifyReply) => void;
    getVerifiedEmail: (request: FastifyRequest) => Promise<string | null>;
  }
}

export interface AuthOptions {
  jwtSecret: string;
  cookieSecure: boolean;
  /** Verifies Cloudflare Access JWTs; null when CF_TEAM_DOMAIN / CF_POLICY_AUD aren't configured. */
  cfAccess?: CfAccessValidator | null;
  /** Local development only: trusts X-Dev-Email / DEV_CF_EMAIL in place of Cloudflare Access. */
  allowDevAuth?: boolean;
  devCfEmail?: string;
}

export async function registerAuth(app: FastifyInstance, opts: AuthOptions) {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: opts.jwtSecret,
    cookie: { cookieName: AUTH_COOKIE, signed: false },
    sign: { expiresIn: SESSION_SECONDS },
  });

  app.decorate('authOptions', opts);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Not authenticated' });
    }
  });

  app.decorate('setSession', async (reply: FastifyReply, userId: string) => {
    const token = await reply.jwtSign({ sub: userId });
    reply.setCookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.cookieSecure,
      path: '/',
      maxAge: SESSION_SECONDS,
    });
  });

  app.decorate('clearSession', (reply: FastifyReply) => {
    reply.clearCookie(AUTH_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: opts.cookieSecure });
  });

  /**
   * The Google account email Cloudflare Access vouches for, or null. Only a verified
   * Cf-Access-Jwt-Assertion counts; a bare Cf-Access-Authenticated-User-Email header is spoofable.
   */
  app.decorate('getVerifiedEmail', async (request: FastifyRequest): Promise<string | null> => {
    const assertion = header(request, 'cf-access-jwt-assertion');
    if (assertion) {
      if (!opts.cfAccess) {
        request.log.warn('cf_auth: Cf-Access-Jwt-Assertion received but Cloudflare Access is not configured');
        return null;
      }
      try {
        return await opts.cfAccess.verify(assertion);
      } catch (err) {
        request.log.warn({ err }, 'cf_auth: Cf-Access-Jwt-Assertion validation failed');
        return null;
      }
    }

    const spoofed = header(request, 'cf-access-authenticated-user-email');
    if (spoofed) {
      request.log.warn(`cf_auth: rejected Cf-Access-Authenticated-User-Email ${JSON.stringify(spoofed)} without Cf-Access-Jwt-Assertion`);
      return null;
    }

    if (opts.allowDevAuth) {
      const devHeader = header(request, 'x-dev-email');
      if (devHeader) {
        request.log.warn(`cf_auth: using X-Dev-Email=${JSON.stringify(devHeader)} for development`);
        return devHeader.toLowerCase();
      }
      if (request.cookies[DEV_LOGGED_OUT_COOKIE] === 'true') return null;
      if (opts.devCfEmail) {
        request.log.warn(`cf_auth: using DEV_CF_EMAIL=${JSON.stringify(opts.devCfEmail)} for development`);
        return opts.devCfEmail.trim().toLowerCase();
      }
    }
    return null;
  });
}

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { devLoginSchema, registerSchema } from '../schemas.js';
import { DEV_LOGGED_OUT_COOKIE } from '../plugins/auth.js';

// Cookies Cloudflare Access sets on the app hostname. The team-domain logout can't remove them.
const CF_ACCESS_COOKIES = ['CF_Authorization', 'CF_Binding', 'CF_Device', 'CF_Session'];

function publicUser(user: { id: string; email: string; username: string }) {
  return { id: user.id, email: user.email, username: user.username };
}

function findUserByEmail(email: string) {
  return prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
}

export async function authRoutes(app: FastifyInstance) {
  const { allowDevAuth, cfAccess } = app.authOptions;

  function clearDevLoggedOut(reply: FastifyReply) {
    if (allowDevAuth) reply.clearCookie(DEV_LOGGED_OUT_COOKIE, { path: '/', sameSite: 'lax' });
  }

  /**
   * Session probe. Reports whether Cloudflare Access vouches for a Google account and whether that
   * account has a Music Box user; for a registered user it also issues a fresh app session cookie.
   */
  app.get('/api/auth/cf-session', async (request, reply) => {
    const email = await app.getVerifiedEmail(request);
    if (!email) return { authenticated: false, registered: false };

    const user = await findUserByEmail(email);
    if (!user) return { authenticated: true, registered: false, email };

    await app.setSession(reply, user.id);
    return { authenticated: true, registered: true, email: user.email, user: publicUser(user) };
  });

  // Full-page navigation target: without an Access session it starts the Cloudflare Access Google login.
  app.get('/api/auth/google', async (request, reply) => {
    clearDevLoggedOut(reply);
    const email = await app.getVerifiedEmail(request);
    if (!email) {
      return reply.redirect(allowDevAuth ? '/login?auth=dev_login' : '/cdn-cgi/access/login');
    }
    const user = await findUserByEmail(email);
    if (!user) return reply.redirect('/login?auth=new_user');
    await app.setSession(reply, user.id);
    return reply.redirect('/library');
  });

  app.post('/api/auth/register', async (request, reply) => {
    const email = await app.getVerifiedEmail(request);
    if (!email) {
      return reply.code(401).send({ error: 'Sign in with Google through Cloudflare Access to register' });
    }

    const parsed = registerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid registration details', issues: parsed.error.issues });
    }
    if (parsed.data.email && parsed.data.email !== email) {
      return reply.code(403).send({ error: 'Registration email must match your Google account' });
    }

    if (await findUserByEmail(email)) {
      return reply.code(409).send({ error: 'An account with that email already exists' });
    }

    const user = await prisma.user.create({ data: { email, username: parsed.data.username } });
    await app.setSession(reply, user.id);
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    clearDevLoggedOut(reply);
    let email = await app.getVerifiedEmail(request);
    if (!email && allowDevAuth) {
      const parsed = devLoginSchema.safeParse(request.body ?? {});
      email = (parsed.success && parsed.data.email) || app.authOptions.devCfEmail?.trim().toLowerCase() || null;
    }
    if (!email) {
      return reply.code(401).send({ error: 'Sign in with Google through Cloudflare Access' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return reply.code(404).send({ error: 'No Music Box account for this Google account yet; please register' });
    }

    await app.setSession(reply, user.id);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    app.clearSession(reply);
    if (allowDevAuth) {
      reply.setCookie(DEV_LOGGED_OUT_COOKIE, 'true', { path: '/', sameSite: 'lax' });
    }
    if (!cfAccess) return { ok: true };

    // The app-domain /cdn-cgi/access/logout only clears this hostname's cookie; the global Access
    // session lives on the team domain and would silently sign the same Google account back in.
    // The client navigates to cf_logout_url instead. That logout can't remove this hostname's Access
    // cookies, and Access keeps accepting the revoked token for 20-30s, so expire them here.
    for (const name of CF_ACCESS_COOKIES) {
      reply.clearCookie(name, { path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
    }
    return { ok: true, cf_logout_url: `${cfAccess.teamDomain}/cdn-cgi/access/logout` };
  });
}

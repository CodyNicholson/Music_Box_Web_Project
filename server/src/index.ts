import { buildApp } from './app.js';
import { prisma } from './db.js';
import { CfAccessValidator } from './cfAccess.js';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16) {
  console.error('JWT_SECRET must be set (at least 16 characters).');
  process.exit(1);
}

// Users sign in with Google through Cloudflare Access; the server verifies the Access JWT on each session check.
const cfTeamDomain = process.env.CF_TEAM_DOMAIN?.trim() ?? '';
const cfPolicyAud = process.env.CF_POLICY_AUD?.trim() ?? '';
const cfAccess = cfTeamDomain && cfPolicyAud ? new CfAccessValidator(cfTeamDomain, cfPolicyAud, { certsUrl: process.env.CF_CERTS_URL }) : null;
const allowDevAuth = process.env.ALLOW_DEV_AUTH === 'true' || process.env.ALLOW_DEV_AUTH === '1';

const app = await buildApp({
  jwtSecret,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cfAccess,
  allowDevAuth,
  devCfEmail: process.env.DEV_CF_EMAIL,
  logger: true,
});

if (!cfAccess) app.log.warn('CF_TEAM_DOMAIN / CF_POLICY_AUD not set: Cloudflare Access sign-in is disabled');
if (allowDevAuth) app.log.warn('ALLOW_DEV_AUTH is on: X-Dev-Email / DEV_CF_EMAIL are trusted. Never enable this in production.');

const port = Number(process.env.PORT ?? 4000);

async function shutdown() {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host: '0.0.0.0' });

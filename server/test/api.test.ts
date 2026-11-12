import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { CfAccessValidator } from '../src/cfAccess.js';
import { AUTH_COOKIE } from '../src/plugins/auth.js';

// Runs against the database in DATABASE_URL (see README: "Running tests").
const run = `${Date.now()}`;
const alice = { email: `alice-${run}@test.local`, username: 'alice' };
const bob = { email: `bob-${run}@test.local`, username: 'bob' };

const TEAM = 'https://musicbox-test.cloudflareaccess.com';
const AUD = 'test-policy-aud';

let app: FastifyInstance;
let devApp: FastifyInstance;
let signingKey: CryptoKey;

function cookieFrom(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === AUTH_COOKIE);
  if (!c) throw new Error('no auth cookie');
  return `${AUTH_COOKIE}=${c.value}`;
}

function accessJwt(email: string, overrides: { aud?: string; iss?: string; exp?: string } = {}) {
  return new SignJWT({ email, type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuer(overrides.iss ?? TEAM)
    .setAudience(overrides.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? '5m')
    .sign(signingKey);
}

async function cfHeaders(email: string) {
  return { 'cf-access-jwt-assertion': await accessJwt(email) };
}

const sampleSong = {
  title: 'Test tune',
  bpm: 100,
  timeSignature: '4/4',
  tracks: [
    {
      name: 'Piano',
      instrument: 'piano',
      notes: [
        { pitch: 'E4', startTime: 0, duration: 'q', velocity: 0.7 },
        { pitch: 'C4', startTime: 0, duration: 'h' },
        { pitch: 'G4', startTime: 1, duration: 'q' },
      ],
    },
  ],
};

const ensembleSong = {
  title: 'Ensemble',
  bpm: 90,
  timeSignature: '3/4',
  tracks: [
    { name: 'Violin', instrument: 'violin', volume: 0.6, notes: [{ pitch: 'A5', startTime: 0, duration: 'h' }] },
    { name: 'Cello', instrument: 'cello', muted: true, notes: [{ pitch: 'C3', startTime: 0, duration: 'h' }, { pitch: 'G2', startTime: 2, duration: 'q' }] },
    { name: 'Guitar', instrument: 'acoustic-guitar', notes: [] },
    { name: 'Drums', instrument: 'drums', notes: [{ pitch: 'C2', startTime: 0, duration: 'q' }, { pitch: 'F#2', startTime: 0, duration: '8' }] },
  ],
};

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  signingKey = privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-kid', alg: 'RS256' };
  const cfAccess = new CfAccessValidator('musicbox-test', AUD, { keys: createLocalJWKSet({ keys: [jwk] }) });
  app = await buildApp({ jwtSecret: 'test-secret-test-secret', cookieSecure: false, cfAccess });
  devApp = await buildApp({ jwtSecret: 'test-secret-test-secret', cookieSecure: false, allowDevAuth: true });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [alice.email, bob.email] } } });
  await app.close();
  await devApp.close();
  await prisma.$disconnect();
});

describe('cloudflare access auth', () => {
  it('rejects missing, spoofed and invalid Access identities', async () => {
    const session = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/api/auth/cf-session', headers });
    expect((await session({})).json()).toEqual({ authenticated: false, registered: false });
    expect((await session({ 'cf-access-authenticated-user-email': alice.email })).json().authenticated).toBe(false);
    expect((await session({ 'x-dev-email': alice.email })).json().authenticated).toBe(false);
    for (const bad of [{ aud: 'other-aud' }, { iss: 'https://evil.cloudflareaccess.com' }, { exp: '-1m' }]) {
      const res = await session({ 'cf-access-jwt-assertion': await accessJwt(alice.email, bad) });
      expect(res.json().authenticated).toBe(false);
    }
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice' } });
    expect(reg.statusCode).toBe(401);
  });

  it('registers a verified Google account, then restores its session', async () => {
    const headers = await cfHeaders(alice.email.toUpperCase());

    const before = await app.inject({ method: 'GET', url: '/api/auth/cf-session', headers });
    expect(before.json()).toEqual({ authenticated: true, registered: false, email: alice.email });
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/auth/google', headers })).headers.location).toBe('/login?auth=new_user');

    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers,
      payload: { username: 'alice', email: bob.email },
    });
    expect(mismatch.statusCode).toBe(403);

    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username: 'alice' } });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user).toMatchObject({ email: alice.email, username: 'alice' });
    expect(reg.cookies.find((c) => c.name === AUTH_COOKIE)?.httpOnly).toBe(true);

    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username: 'alice' } });
    expect(dup.statusCode).toBe(409);

    const after = await app.inject({ method: 'GET', url: '/api/auth/cf-session', headers });
    expect(after.json()).toMatchObject({ authenticated: true, registered: true, user: { email: alice.email } });
    const songs = await app.inject({ method: 'GET', url: '/api/songs', headers: { cookie: cookieFrom(after) } });
    expect(songs.statusCode).toBe(200);

    const google = await app.inject({ method: 'GET', url: '/api/auth/google', headers });
    expect(google.headers.location).toBe('/library');
    expect(cookieFrom(google)).toContain(AUTH_COOKIE);
  });

  it('sends unauthenticated visitors to the Access login and logs out via the team domain', async () => {
    const google = await app.inject({ method: 'GET', url: '/api/auth/google' });
    expect(google.statusCode).toBe(302);
    expect(google.headers.location).toBe('/cdn-cgi/access/login');

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(logout.json()).toEqual({ ok: true, cf_logout_url: `${TEAM}/cdn-cgi/access/logout` });
    const cleared = logout.cookies.filter((c) => c.value === '').map((c) => c.name);
    expect(cleared).toEqual(expect.arrayContaining([AUTH_COOKIE, 'CF_Authorization']));
  });

  it('rejects unauthenticated song requests', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/songs' })).statusCode).toBe(401);
  });
});

describe('dev auth', () => {
  it('only works when enabled, and logout stops automatic sign-in', async () => {
    const devLogin = await devApp.inject({ method: 'POST', url: '/api/auth/login', payload: { email: alice.email } });
    expect(devLogin.statusCode).toBe(200);
    expect(devLogin.json().user.email).toBe(alice.email);

    const logout = await devApp.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(logout.json()).toEqual({ ok: true });
    expect(logout.cookies.find((c) => c.name === 'dev_cf_logged_out')?.value).toBe('true');
  });
});

describe('songs', () => {
  it('supports CRUD for the owner and hides songs from other users', async () => {
    const aliceCookie = cookieFrom(
      await app.inject({ method: 'POST', url: '/api/auth/login', headers: await cfHeaders(alice.email) }),
    );
    const bobCookie = cookieFrom(
      await app.inject({ method: 'POST', url: '/api/auth/register', headers: await cfHeaders(bob.email), payload: { username: 'bob' } }),
    );

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/songs',
      headers: { cookie: aliceCookie },
      payload: { ...sampleSong, tracks: [{ name: 'Piano', instrument: 'piano', notes: [{ pitch: 'H9', startTime: -1, duration: 'x' }] }] },
    });
    expect(invalid.statusCode).toBe(400);

    for (const tracks of [
      [],
      [{ name: 'Kazoo', instrument: 'kazoo', notes: [] }],
      [{ name: 'Drums', instrument: 'drums', notes: [{ pitch: 'A4', startTime: 0, duration: 'q' }] }],
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/songs', headers: { cookie: aliceCookie }, payload: { ...sampleSong, tracks } });
      expect(res.statusCode).toBe(400);
    }

    const created = await app.inject({
      method: 'POST',
      url: '/api/songs',
      headers: { cookie: aliceCookie },
      payload: sampleSong,
    });
    expect(created.statusCode).toBe(201);
    const song = created.json().song;
    expect(song.tracks).toHaveLength(1);
    expect(song.tracks[0]).toMatchObject({ name: 'Piano', instrument: 'piano', volume: 0.8, muted: false });
    expect(song.tracks[0].notes).toHaveLength(3);
    expect(song.tracks[0].notes[0]).toMatchObject({ pitch: 'C4', startTime: 0, duration: 'h', velocity: 0.8 });

    const list = await app.inject({ method: 'GET', url: '/api/songs', headers: { cookie: aliceCookie } });
    expect(list.json().songs).toEqual([expect.objectContaining({ id: song.id, noteCount: 3, instruments: ['piano'] })]);

    const bobList = await app.inject({ method: 'GET', url: '/api/songs', headers: { cookie: bobCookie } });
    expect(bobList.json().songs).toEqual([]);

    for (const req of [
      { method: 'GET' as const, url: `/api/songs/${song.id}` },
      { method: 'PUT' as const, url: `/api/songs/${song.id}`, payload: sampleSong },
      { method: 'DELETE' as const, url: `/api/songs/${song.id}` },
    ]) {
      const res = await app.inject({ ...req, headers: { cookie: bobCookie } });
      expect(res.statusCode).toBe(404);
    }

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/songs/${song.id}`,
      headers: { cookie: aliceCookie },
      payload: { ...ensembleSong, title: 'Renamed', bpm: 140 },
    });
    expect(updated.statusCode).toBe(200);
    const ensemble = updated.json().song;
    expect(ensemble).toMatchObject({ title: 'Renamed', bpm: 140, timeSignature: '3/4' });
    expect(ensemble.tracks.map((t: { instrument: string }) => t.instrument)).toEqual(['violin', 'cello', 'acoustic-guitar', 'drums']);
    expect(ensemble.tracks[0]).toMatchObject({ volume: 0.6, muted: false });
    expect(ensemble.tracks[1]).toMatchObject({ muted: true });
    expect(ensemble.tracks[1].notes.map((n: { pitch: string }) => n.pitch)).toEqual(['C3', 'G2']);
    expect(ensemble.tracks[2].notes).toEqual([]);
    expect(ensemble.tracks[3].notes).toHaveLength(2);
    // The old piano track and its notes were replaced.
    expect(await prisma.songTrack.count({ where: { songId: song.id } })).toBe(4);
    expect(await prisma.songNote.count({ where: { track: { songId: song.id } } })).toBe(5);

    const fetched = await app.inject({ method: 'GET', url: `/api/songs/${song.id}`, headers: { cookie: aliceCookie } });
    expect(fetched.json().song.tracks).toEqual(ensemble.tracks);

    const del = await app.inject({ method: 'DELETE', url: `/api/songs/${song.id}`, headers: { cookie: aliceCookie } });
    expect(del.statusCode).toBe(204);
    expect(await prisma.songTrack.count({ where: { songId: song.id } })).toBe(0);
    expect(await prisma.songNote.count({ where: { track: { songId: song.id } } })).toBe(0);
  });

  it('accepts the old flat notes payload as a single piano track', async () => {
    const cookie = cookieFrom(await app.inject({ method: 'POST', url: '/api/auth/login', headers: await cfHeaders(alice.email) }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/songs',
      headers: { cookie },
      payload: { title: 'Legacy', bpm: 120, timeSignature: '4/4', notes: [{ pitch: 'C4', startTime: 0, duration: 'q' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().song.tracks).toEqual([
      expect.objectContaining({ name: 'Piano', instrument: 'piano', notes: [expect.objectContaining({ pitch: 'C4' })] }),
    ]);
  });
});

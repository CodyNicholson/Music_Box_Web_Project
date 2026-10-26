# Music Box Web

Compose songs on a virtual piano, see them as grand-staff sheet music, and play them back with the
score, playhead and piano keys in sync. Users sign in with Google through Cloudflare Access and keep a
private library of saved songs.

| Layer | Tech |
| --- | --- |
| Frontend | Vue 3 (`<script setup>`) + TypeScript + Vite, Pinia, Vue Router 4 |
| Audio | Tone.js: `Sampler` (Salamander Grand Piano), `Transport`, `Part`, `Draw` |
| Notation | VexFlow 4 (SVG backend, Bravura font) |
| API | Fastify 5 + TypeScript, Cloudflare Access JWT verification (jose), session JWT in an HTTP-only cookie, Zod validation |
| Data | PostgreSQL 16 + Prisma 6 (`users` → `songs` → `song_notes`, cascading deletes) |

## Running it

Requires Docker only (Node runs inside the containers).

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env   # once; pipeline-run.sh does this for you
docker compose up --build        # Postgres :5434, API :4000, client (nginx) :5173
```

Open <http://localhost:5173>, sign in, then **Start from example** or **New song**.
The containers run production builds (compiled server, minified client behind nginx), so rebuild
after code changes. For hot reload, run `npm run dev` in `server/` and `client/` instead.
Migrations run when the server starts. Session cookies are `Secure` by default; set
`COOKIE_SECURE=false` if your browser rejects them on plain HTTP.

### Sign-in (Google OAuth through Cloudflare Access)

There are no passwords. Cloudflare Access puts its Google sign-in in front of the site and adds a
signed `Cf-Access-Jwt-Assertion` header to every request. The server verifies that JWT against the
team's public certs, the application's AUD tag and the issuer, and only trusts the email inside it.
A bare `Cf-Access-Authenticated-User-Email` header is rejected.

- Set `CF_TEAM_DOMAIN` and `CF_POLICY_AUD` in `.env`. Without them nobody can sign in in production.
- `GET /api/auth/cf-session` reports the Google identity. For a registered user it also issues a
  15-minute app session cookie. A first-time Google account picks a username, and its email always
  comes from Access.
- The client renews the session through `cf-session` when an API call returns 401, and again when you
  come back to a tab after a minute or more. If the Access session has expired, the page reloads so
  Access shows its Google sign-in, which then returns you to the same page.
- **Log out** clears the app session and this hostname's Access cookies. It then goes to the team
  domain's `/cdn-cgi/access/logout`, which ends the global Access session and returns you to the
  Access login.
- **Local development** (no Access on localhost): set `ALLOW_DEV_AUTH=true` (and optionally
  `DEV_CF_EMAIL`) in `.env`. The login page then takes any email. Never enable this in production.

The piano samples load from `tonejs.github.io`, so playback needs internet access.

### Security

- Host ports are bound to `127.0.0.1` only. Docker publishes ports through its own iptables rules,
  which bypass host firewalls such as `ufw`, so a bare `5173:80` would be reachable from outside.
- `JWT_SECRET` and `DB_PASSWORD` have no fallback: compose refuses to start until they are set.
- Postgres is only on `backend-net` with the API; the public nginx container cannot reach it.
- The API trusts only a verified `Cf-Access-Jwt-Assertion` (signature, audience, issuer), never
  a bare `Cf-Access-Authenticated-User-Email` header.
- nginx runs unprivileged (uid 101) with all capabilities dropped, `no-new-privileges`, and memory,
  CPU and process limits; the other containers have `no-new-privileges` and memory and process limits.
- Every response carries `Content-Security-Policy` (same-origin only, no framing),
  `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`
  (`client/security-headers.conf`); the nginx version is hidden.

### Running tests

```bash
# API integration tests (uses the musicbox_test database created on first DB start)
docker compose exec server npm run test:db

# Client unit tests and type-check/build
docker compose exec client npm test
docker compose exec client npm run build
```

## Using the studio

- **Piano**: click keys or type `A`–`L` (black keys `W E T Y U O`); `Z`/`X` shift the octave.
  With **Step input** on, each key press adds a note at the start beat and moves the start beat forward.
- **Editor**: set pitch, start beat (quarter-note beats, snapped to sixteenths), duration and velocity.
  Click a note in the score or the list to edit it. Clicking a chord again cycles through its notes.
- **Shortcuts**: `Space` play/pause, `Ctrl+S` save, `Esc` deselect, `Del` delete the selected note.
- BPM changes apply immediately, including during playback.

## How it's put together

```
server/
  prisma/schema.prisma        User 1─* Song 1─* SongNote
  src/plugins/auth.ts         cookie + JWT setup, `authenticate` preHandler
  src/cfAccess.ts             verifies Cf-Access-Jwt-Assertion (team certs, AUD, issuer)
  src/routes/auth.ts          GET cf-session/google, POST register/login/logout
  src/routes/songs.ts         GET/POST /api/songs, GET/PUT/DELETE /api/songs/:id (owner-scoped)
client/src/
  composables/usePianoAudio.ts     shared Tone.js engine: playback, pause/stop, auditioning
  composables/useSheetRenderer.ts  VexFlow grand staff, note→SVG map, beat→x timeline
  utils/measures.ts                groups notes into measures, fills gaps with rests (pure, tested)
  stores/songStore.ts              current song, dirty/save state, active notes & pitches
  components/studio/               TransportBar, SheetMusicStage, NoteEditorPanel, VirtualPiano
```

**Timing model.** `startTime` is measured in quarter-note beats and `bpm` counts quarter notes, so
6/8 is three beats per bar. Notes go into a `Tone.Part` at Transport *tick* positions, so the
Web Audio clock schedules the sound and tempo changes take effect live. Highlight on/off
callbacks go through `Tone.Draw.schedule`, so Vue state changes on the animation frame where
the note is heard. The playhead reads `transport.getTicksAtTime(Tone.immediate())`, the audible
time rather than the look-ahead time, and interpolates between the x positions of the drawn
notes.

**Notation rules.** Notes from middle C (C4) up go on the treble staff and lower notes on the
bass staff. Notes that start together become a chord. A note is drawn no longer than the gap
before the next note on its staff or the end of its bar. Silent gaps are filled with (dotted)
rests, so every bar is full.

**API ownership.** Every song query is filtered by `userId = <JWT subject>`. Requests for another
user's song get a 404, so the API doesn't reveal that the song exists. Saving a song replaces
its note rows inside one transaction.

## Known limitations / next steps

- Notes that cross a barline, or that are cut short by the next note, are shortened on the
  score instead of being tied. Playback still uses their full length.
- One voice per staff: overlapping notes that don't start together show as consecutive.
- No rate limiting on the login and register endpoints yet.
- Docker setup is for development; a production build would serve `client/dist` behind a reverse proxy.

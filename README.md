# Music Box Web

Compose songs for one or more instruments (piano, acoustic and electric guitar, bass guitar, violin,
cello, flute and drums), see each instrument on its own staff, and play them all back together with
the score, playhead and keyboard in sync. Users sign in with Google through Cloudflare Access and keep a
private library of saved songs.

| Layer | Tech |
| --- | --- |
| Frontend | Vue 3 (`<script setup>`) + TypeScript + Vite, Pinia, Vue Router 4 |
| Audio | Tone.js: one `Sampler` per instrument, `Transport`, `Part`, `Draw` |
| Notation | VexFlow 4 (SVG backend, Bravura font) |
| API | Fastify 5 + TypeScript, Cloudflare Access JWT verification (jose), session JWT in an HTTP-only cookie, Zod validation |
| Data | PostgreSQL 16 + Prisma 6 (`users` → `songs` → `song_tracks` → `song_notes`, cascading deletes) |

## Running it

Requires Docker only (Node runs inside the containers).

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env   # once; pipeline-run.sh does this for you
docker compose up --build        # Postgres :5434, API :4000, client (nginx) :5173
```

Open <http://localhost:5173>, sign in, then open one of the **Sample songs** or start a **New song**.
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

Instrument samples load from `tonejs.github.io` (Salamander piano, acoustic drum kit) and
`nbrosowsky.github.io` ([tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments), CC-BY 3.0:
guitars, bass, violin, cello, flute), so playback needs internet access. Each instrument downloads the
first time it appears in a song.

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

- **Sample songs**: the library lists six public-domain tunes, each arranged for a different band.
  Opening one loads a fresh, unsaved copy (`/studio?example=<id>`); **Save** stores it as your own song.

  | Song | Time | Instruments |
  | --- | --- | --- |
  | Ode to Joy | 4/4 | violin, piano, cello, drums |
  | Twinkle, Twinkle, Little Star | 4/4 | flute, piano |
  | When the Saints Go Marching In | 4/4 | electric guitar, piano, bass guitar, drums |
  | Amazing Grace | 3/4 | cello, acoustic guitar |
  | Jingle Bells (chorus) | 4/4 | violin, acoustic guitar, bass guitar, drums |
  | Greensleeves | 6/8 | flute, acoustic guitar, cello |

- **Instruments**: every song starts with a piano. **+ Add instrument** adds another staff for a
  piano, guitar, bass, violin, cello, flute or drum kit (up to 12). Click an instrument (in the list
  or on its staff in the score) to make it the one you write for; the keyboard, note editor and note
  list then work on that staff. Each instrument has a name, mute, volume and up/down order. Play runs
  every staff together.
- **Keyboard**: click keys or type `A`–`L` (black keys `W E T Y U O`); `Z`/`X` shift the octave. The
  range follows the active instrument. With **Step input** on, each key press adds a note at the start
  beat and moves the start beat forward.
- **Drum kit**: a drum track shows pads instead of keys (`A` kick, `S` snare, `D` hi-hat, `F` crash,
  `G`/`H`/`J` high, mid and floor tom). Drum notes are drawn on a percussion staff, cymbals with x
  noteheads. A track with notes can switch between pitched instruments, but not to or from drums.
- **Editor**: set pitch, start beat (quarter-note beats, snapped to sixteenths), duration and velocity.
  Click a note in the score or the list to edit it. Clicking a chord again cycles through its notes.
- **Shortcuts**: `Space` play/pause, `Ctrl+S` save, `Esc` deselect, `Del` delete the selected note.
- BPM changes apply immediately, including during playback.

## How it's put together

```
server/
  prisma/schema.prisma        User 1─* Song 1─* SongTrack 1─* SongNote
  src/plugins/auth.ts         cookie + JWT setup, `authenticate` preHandler
  src/cfAccess.ts             verifies Cf-Access-Jwt-Assertion (team certs, AUD, issuer)
  src/routes/auth.ts          GET cf-session/google, POST register/login/logout
  src/routes/songs.ts         GET/POST /api/songs, GET/PUT/DELETE /api/songs/:id (owner-scoped)
client/src/
  composables/useAudioEngine.ts    shared Tone.js engine: one sampler per instrument, playback, auditioning
  composables/useSheetRenderer.ts  VexFlow staves for every track, note→SVG map, beat→x timeline
  utils/instruments.ts             instrument definitions: staves/clefs, ranges, samples, drum kit map
  utils/measures.ts                groups notes into measures, fills gaps with rests (pure, tested)
  utils/examples.ts                the sample songs: melodies as text, chord charts, accompaniment patterns
  stores/songStore.ts              current song and tracks, active track, dirty/save state, active notes
  components/studio/               TransportBar, InstrumentTracks, SheetMusicStage, NoteEditorPanel,
                                   VirtualPiano, DrumPad
```

**Timing model.** `startTime` is measured in quarter-note beats and `bpm` counts quarter notes, so
6/8 is three beats per bar. Notes go into a `Tone.Part` at Transport *tick* positions, so the
Web Audio clock schedules the sound and tempo changes take effect live. Highlight on/off
callbacks go through `Tone.Draw.schedule`, so Vue state changes on the animation frame where
the note is heard. The playhead reads `transport.getTicksAtTime(Tone.immediate())`, the audible
time rather than the look-ahead time, and interpolates between the x positions of the drawn
notes.

**Tracks.** A song has one or more tracks (`song_tracks`: name, instrument, volume, muted, position),
and each note belongs to a track. Notes store the sounding pitch; drum notes use General MIDI drum
pitches (C2 kick, D2 snare, F#2 hi-hat, C#3 crash, D3/B2/G2 toms). All tracks go into one `Tone.Part`,
so they share the Transport clock; mute and volume are read when each note fires, so they apply during
playback. The API still accepts the old flat `notes` payload and saves it as one piano track, and the
`song_tracks` migration moved every existing song's notes into a piano track.

**Notation rules.** Each instrument has its own staff, labelled on the left, and all staves share the
same bars. Piano uses a grand staff: notes from middle C (C4) up go on the treble staff and lower notes
on the bass staff. Violin and flute use treble clef, cello bass clef, guitars a treble clef and bass
guitar a bass clef with an "8" below (written an octave above how they sound), and drums a percussion
staff. Notes that start together become a chord. A note is drawn no longer than the gap
before the next note on its staff or the end of its bar. Silent gaps are filled with (dotted)
rests, so every bar is full.

**API ownership.** Every song query is filtered by `userId = <JWT subject>`. Requests for another
user's song get a 404, so the API doesn't reveal that the song exists. Saving a song replaces
its note rows inside one transaction.

## Known limitations / next steps

- Notes that cross a barline, or that are cut short by the next note, are shortened on the
  score instead of being tied. Playback still uses their full length.
- One voice per staff: overlapping notes that don't start together show as consecutive.
- The crash cymbal is synthesized (the sampled kit has no cymbals), so it sounds less natural than the
  other drums.
- No rate limiting on the login and register endpoints yet.
- Docker setup is for development; a production build would serve `client/dist` behind a reverse proxy.

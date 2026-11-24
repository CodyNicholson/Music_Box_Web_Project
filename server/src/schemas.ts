import { z } from 'zod';

export const NOTE_DURATIONS = ['w', 'h', 'q', '8', '16'] as const;
export const TIME_SIGNATURES = ['4/4', '3/4', '6/8'] as const;

// The email comes from the verified Cloudflare Access identity; if the client sends one it must match.
export const registerSchema = z.object({
  username: z.string().trim().min(2).max(40),
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
});

// Only honoured when ALLOW_DEV_AUTH is on (local development without Cloudflare Access).
export const devLoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).optional(),
});

export const noteSchema = z.object({
  // Client-side ids are accepted but not persisted; the database assigns new ones.
  id: z.string().optional(),
  pitch: z.string().regex(/^[A-G](#|b)?[0-8]$/, 'Pitch must look like C4, F#5 or Bb3'),
  startTime: z.number().min(0).max(10_000),
  duration: z.enum(NOTE_DURATIONS),
  velocity: z.number().min(0).max(1).optional(),
});

// Keep in sync with client/src/utils/instruments.ts.
export const INSTRUMENTS = [
  'piano',
  'acoustic-guitar',
  'electric-guitar',
  'bass-guitar',
  'violin',
  'cello',
  'double-bass',
  'flute',
  'clarinet',
  'saxophone',
  'trumpet',
  'trombone',
  'dulcimer',
  'drums',
] as const;

/** General MIDI drum notes the drum kit can play: kick, snare, hi-hat, three toms and a crash. */
export const DRUM_PITCHES = ['C2', 'D2', 'F#2', 'G2', 'B2', 'D3', 'C#3'] as const;

export const MAX_TRACKS = 12;
export const MAX_NOTES = 5_000;

export const trackSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1).max(40),
    instrument: z.enum(INSTRUMENTS),
    volume: z.number().min(0).max(1).optional(),
    muted: z.boolean().optional(),
    notes: z.array(noteSchema).max(MAX_NOTES),
  })
  .superRefine((track, ctx) => {
    if (track.instrument !== 'drums') return;
    track.notes.forEach((n, i) => {
      if (!(DRUM_PITCHES as readonly string[]).includes(n.pitch)) {
        ctx.addIssue({ code: 'custom', path: ['notes', i, 'pitch'], message: `Drum notes must be one of ${DRUM_PITCHES.join(', ')}` });
      }
    });
  });

/** Songs saved before tracks existed sent a flat `notes` array; treat that as one piano track. */
function legacyNotesToTracks(raw: unknown) {
  if (raw && typeof raw === 'object' && !('tracks' in raw) && Array.isArray((raw as { notes?: unknown }).notes)) {
    const { notes, ...rest } = raw as Record<string, unknown>;
    return { ...rest, tracks: [{ name: 'Piano', instrument: 'piano', notes }] };
  }
  return raw;
}

export const songSchema = z.preprocess(
  legacyNotesToTracks,
  z
    .object({
      title: z.string().trim().min(1).max(120),
      bpm: z.number().int().min(20).max(300),
      timeSignature: z.enum(TIME_SIGNATURES),
      tracks: z.array(trackSchema).min(1).max(MAX_TRACKS),
    })
    .refine((song) => song.tracks.reduce((sum, t) => sum + t.notes.length, 0) <= MAX_NOTES, {
      message: `A song can have at most ${MAX_NOTES} notes`,
      path: ['tracks'],
    }),
);

export type SongInput = z.infer<typeof songSchema>;

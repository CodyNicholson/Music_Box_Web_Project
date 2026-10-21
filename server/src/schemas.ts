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

export const songSchema = z.object({
  title: z.string().trim().min(1).max(120),
  bpm: z.number().int().min(20).max(300),
  timeSignature: z.enum(TIME_SIGNATURES),
  notes: z.array(noteSchema).max(5_000),
});

export type SongInput = z.infer<typeof songSchema>;

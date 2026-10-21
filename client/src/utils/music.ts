import type { NoteDuration, TimeSignature } from '@/types/music';

/** Length of each duration in quarter-note beats. */
export const DURATION_BEATS: Record<NoteDuration, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };

export const DURATION_OPTIONS: { value: NoteDuration; label: string }[] = [
  { value: 'w', label: 'Whole' },
  { value: 'h', label: 'Half' },
  { value: 'q', label: 'Quarter' },
  { value: '8', label: 'Eighth' },
  { value: '16', label: 'Sixteenth' },
];

export const TIME_SIGNATURES: TimeSignature[] = ['4/4', '3/4', '6/8'];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PITCH_RE = /^([A-G])(#|b)?(\d)$/;

export function isValidPitch(pitch: string): boolean {
  return PITCH_RE.test(pitch);
}

export function pitchToMidi(pitch: string): number {
  const m = PITCH_RE.exec(pitch);
  if (!m) throw new Error(`Invalid pitch: ${pitch}`);
  const [, letter, accidental, octave] = m;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (Number(octave) + 1) * 12 + LETTER_SEMITONES[letter!]! + offset;
}

export function midiToPitch(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Canonical sharp spelling, so "Bb4" and "A#4" light up the same piano key. */
export function normalizePitch(pitch: string): string {
  return midiToPitch(pitchToMidi(pitch));
}

/** Pitches from `low` to `high` inclusive, e.g. pitchRange('C3', 'C6'). */
export function pitchRange(low: string, high: string): string[] {
  const out: string[] = [];
  for (let m = pitchToMidi(low); m <= pitchToMidi(high); m++) out.push(midiToPitch(m));
  return out;
}

/** Measure length in quarter-note beats (6/8 = three quarter notes). */
export function beatsPerMeasure(ts: TimeSignature): number {
  const [num, den] = ts.split('/').map(Number) as [number, number];
  return num * (4 / den);
}

export function noteEndBeat(note: { startTime: number; duration: NoteDuration }): number {
  return note.startTime + DURATION_BEATS[note.duration];
}

export function songLengthBeats(notes: { startTime: number; duration: NoteDuration }[]): number {
  return notes.reduce((max, n) => Math.max(max, noteEndBeat(n)), 0);
}

/** "bar:beat" position label (both 1-based) for a quarter-note beat offset, e.g. 4.5 in 4/4 -> "2:1.5". */
export function formatPosition(beat: number, ts: TimeSignature): string {
  const perMeasure = beatsPerMeasure(ts);
  const bar = Math.floor(beat / perMeasure + 1e-9) + 1;
  const inBar = beat - (bar - 1) * perMeasure + 1;
  return `${bar}:${Number(inBar.toFixed(2))}`;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // randomUUID is unavailable on plain-HTTP origins other than localhost.
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

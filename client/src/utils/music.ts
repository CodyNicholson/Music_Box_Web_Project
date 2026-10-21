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

/** Chord shapes as semitone offsets from the root. */
export const CHORD_TYPES: { value: string; label: string; intervals: number[] }[] = [
  { value: 'maj', label: 'Major', intervals: [0, 4, 7] },
  { value: 'min', label: 'Minor', intervals: [0, 3, 7] },
  { value: 'dim', label: 'Diminished', intervals: [0, 3, 6] },
  { value: 'aug', label: 'Augmented', intervals: [0, 4, 8] },
  { value: 'sus2', label: 'Sus2', intervals: [0, 2, 7] },
  { value: 'sus4', label: 'Sus4', intervals: [0, 5, 7] },
  { value: '5', label: 'Power (5)', intervals: [0, 7, 12] },
  { value: '6', label: 'Major 6th', intervals: [0, 4, 7, 9] },
  { value: 'm6', label: 'Minor 6th', intervals: [0, 3, 7, 9] },
  { value: '7', label: 'Dominant 7th', intervals: [0, 4, 7, 10] },
  { value: 'maj7', label: 'Major 7th', intervals: [0, 4, 7, 11] },
  { value: 'm7', label: 'Minor 7th', intervals: [0, 3, 7, 10] },
  { value: 'm7b5', label: 'Half-diminished 7th', intervals: [0, 3, 6, 10] },
  { value: 'dim7', label: 'Diminished 7th', intervals: [0, 3, 6, 9] },
  { value: 'add9', label: 'Add 9', intervals: [0, 4, 7, 14] },
  { value: '9', label: 'Dominant 9th', intervals: [0, 4, 7, 10, 14] },
];

/** Highest pitch the piano samples cover. */
const MAX_MIDI = 108; // C8

/** Pitches of a chord built up from `root`, e.g. chordPitches('C4', 'maj') -> ['C4', 'E4', 'G4']. */
export function chordPitches(root: string, type: string): string[] {
  const chord = CHORD_TYPES.find((c) => c.value === type);
  if (!chord) throw new Error(`Unknown chord type: ${type}`);
  const base = pitchToMidi(root);
  return chord.intervals.map((i) => base + i).filter((m) => m <= MAX_MIDI).map(midiToPitch);
}

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

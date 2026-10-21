import type { NoteEvent, TimeSignature } from '@/types/music';
import { DURATION_BEATS, beatsPerMeasure, pitchToMidi } from './music';

export type Clef = 'treble' | 'bass';

/** One drawable symbol on a staff: a note/chord or a rest. */
export interface StaffEvent {
  kind: 'note' | 'rest';
  startBeat: number;
  beats: number;
  /** VexFlow base duration without the rest suffix: 'w', 'h', 'q', '8', '16'. */
  vfDuration: string;
  dots: number;
  pitches: string[];
  noteIds: string[];
}

export interface Measure {
  index: number;
  startBeat: number;
  beats: number;
  treble: StaffEvent[];
  bass: StaffEvent[];
}

/** Grid that note start times snap to, in quarter-note beats (a sixteenth). */
export const QUANTUM = 0.25;

/** Notes from middle C up go on the treble staff, lower notes on the bass staff. */
export const SPLIT_MIDI = 60;

// Representable lengths, longest first. Dotted values let gaps and notes fit with fewer symbols.
const FITS: { beats: number; vfDuration: string; dots: number }[] = [
  { beats: 4, vfDuration: 'w', dots: 0 },
  { beats: 3, vfDuration: 'h', dots: 1 },
  { beats: 2, vfDuration: 'h', dots: 0 },
  { beats: 1.5, vfDuration: 'q', dots: 1 },
  { beats: 1, vfDuration: 'q', dots: 0 },
  { beats: 0.75, vfDuration: '8', dots: 1 },
  { beats: 0.5, vfDuration: '8', dots: 0 },
  { beats: 0.25, vfDuration: '16', dots: 0 },
];

const EPS = 1e-6;

export function quantize(beat: number): number {
  return Math.max(0, Math.round(beat / QUANTUM) * QUANTUM);
}

export function clefFor(pitch: string): Clef {
  return pitchToMidi(pitch) >= SPLIT_MIDI ? 'treble' : 'bass';
}

function largestFit(beats: number) {
  return FITS.find((f) => f.beats <= beats + EPS) ?? FITS[FITS.length - 1]!;
}

function restsBetween(from: number, to: number): StaffEvent[] {
  const rests: StaffEvent[] = [];
  let cursor = from;
  while (to - cursor >= QUANTUM - EPS) {
    const fit = largestFit(to - cursor);
    rests.push({ kind: 'rest', startBeat: cursor, beats: fit.beats, vfDuration: fit.vfDuration, dots: fit.dots, pitches: [], noteIds: [] });
    cursor += fit.beats;
  }
  return rests;
}

interface Chord {
  start: number;
  beats: number;
  pitches: string[];
  noteIds: string[];
}

function chordsFor(notes: NoteEvent[]): Chord[] {
  const byStart = new Map<number, Chord>();
  for (const n of notes) {
    const start = quantize(n.startTime);
    const chord = byStart.get(start) ?? { start, beats: 0, pitches: [], noteIds: [] };
    chord.beats = Math.max(chord.beats, DURATION_BEATS[n.duration]);
    if (!chord.pitches.includes(n.pitch)) chord.pitches.push(n.pitch);
    chord.noteIds.push(n.id);
    byStart.set(start, chord);
  }
  const chords = [...byStart.values()].sort((a, b) => a.start - b.start);
  for (const c of chords) c.pitches.sort((a, b) => pitchToMidi(a) - pitchToMidi(b));
  return chords;
}

/**
 * Lays one staff's notes out measure by measure. A note is drawn no longer than the gap to the
 * next note or the end of its measure, and every silent gap is filled with rests, so each
 * measure's events add up to exactly one full measure.
 */
function layoutStaff(notes: NoteEvent[], measureBeats: number, measureCount: number): StaffEvent[][] {
  const chords = chordsFor(notes);
  const measures: StaffEvent[][] = [];
  let ci = 0;

  for (let m = 0; m < measureCount; m++) {
    const mStart = m * measureBeats;
    const mEnd = mStart + measureBeats;
    const events: StaffEvent[] = [];
    let cursor = mStart;

    while (ci < chords.length && chords[ci]!.start < mEnd - EPS) {
      const chord = chords[ci]!;
      const next = chords[ci + 1];
      events.push(...restsBetween(cursor, chord.start));
      const limit = Math.min(chord.start + chord.beats, next ? next.start : Infinity, mEnd);
      const fit = largestFit(limit - chord.start);
      events.push({
        kind: 'note',
        startBeat: chord.start,
        beats: fit.beats,
        vfDuration: fit.vfDuration,
        dots: fit.dots,
        pitches: chord.pitches,
        noteIds: chord.noteIds,
      });
      cursor = chord.start + fit.beats;
      ci++;
    }

    events.push(...restsBetween(cursor, mEnd));
    measures.push(events);
  }
  return measures;
}

/** Groups a song's notes into grand-staff measures, inserting rests for silent gaps. */
export function groupIntoMeasures(notes: NoteEvent[], timeSignature: TimeSignature, minMeasures = 1): Measure[] {
  const measureBeats = beatsPerMeasure(timeSignature);
  const lastStart = notes.reduce((max, n) => Math.max(max, quantize(n.startTime)), -1);
  const measureCount = Math.max(minMeasures, Math.floor(lastStart / measureBeats) + 1);

  const treble = layoutStaff(notes.filter((n) => clefFor(n.pitch) === 'treble'), measureBeats, measureCount);
  const bass = layoutStaff(notes.filter((n) => clefFor(n.pitch) === 'bass'), measureBeats, measureCount);

  return treble.map((events, index) => ({
    index,
    startBeat: index * measureBeats,
    beats: measureBeats,
    treble: events,
    bass: bass[index]!,
  }));
}

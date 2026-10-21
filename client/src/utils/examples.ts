import type { NoteDuration, Song } from '@/types/music';
import { generateId } from './music';

type Row = [pitch: string, startTime: number, duration: NoteDuration];

// "Ode to Joy" (Beethoven), melody plus simple bass chords. The half notes at
// beats 12 and 28 are drawn as dotted quarters because the next note cuts them short.
const ODE_TO_JOY: Row[] = [
  ['E4', 0, 'q'], ['E4', 1, 'q'], ['F4', 2, 'q'], ['G4', 3, 'q'],
  ['G4', 4, 'q'], ['F4', 5, 'q'], ['E4', 6, 'q'], ['D4', 7, 'q'],
  ['C4', 8, 'q'], ['C4', 9, 'q'], ['D4', 10, 'q'], ['E4', 11, 'q'],
  ['E4', 12, 'h'], ['D4', 13.5, '8'], ['D4', 14, 'h'],
  ['E4', 16, 'q'], ['E4', 17, 'q'], ['F4', 18, 'q'], ['G4', 19, 'q'],
  ['G4', 20, 'q'], ['F4', 21, 'q'], ['E4', 22, 'q'], ['D4', 23, 'q'],
  ['C4', 24, 'q'], ['C4', 25, 'q'], ['D4', 26, 'q'], ['E4', 27, 'q'],
  ['D4', 28, 'h'], ['C4', 29.5, '8'], ['C4', 30, 'h'],
  ['C3', 0, 'w'], ['G3', 0, 'w'],
  ['B2', 4, 'h'], ['G3', 4, 'h'], ['G2', 6, 'h'], ['F3', 6, 'h'],
  ['C3', 8, 'w'], ['E3', 8, 'w'],
  ['G2', 12, 'w'], ['B2', 12, 'w'],
  ['C3', 16, 'w'], ['G3', 16, 'w'],
  ['B2', 20, 'h'], ['G3', 20, 'h'], ['G2', 22, 'h'], ['F3', 22, 'h'],
  ['C3', 24, 'w'], ['E3', 24, 'w'],
  ['G2', 28, 'h'], ['F3', 28, 'h'], ['C3', 30, 'h'], ['E3', 30, 'h'],
];

export function exampleSong(): Song {
  return {
    title: 'Ode to Joy',
    bpm: 110,
    timeSignature: '4/4',
    notes: ODE_TO_JOY.map(([pitch, startTime, duration]) => ({ id: generateId(), pitch, startTime, duration, velocity: 0.8 })),
  };
}

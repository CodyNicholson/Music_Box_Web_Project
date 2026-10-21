import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/types/music';
import { groupIntoMeasures, type StaffEvent } from './measures';

let seq = 0;
const note = (pitch: string, startTime: number, duration: NoteEvent['duration']): NoteEvent => ({
  id: `n${seq++}`,
  pitch,
  startTime,
  duration,
});

const total = (events: StaffEvent[]) => events.reduce((s, e) => s + e.beats, 0);
const shape = (events: StaffEvent[]) =>
  events.map((e) => `${e.kind === 'rest' ? 'r' : e.pitches.join('+')}:${e.vfDuration}${'.'.repeat(e.dots)}`);

describe('groupIntoMeasures', () => {
  it('fills an empty song with a whole-measure rest on both staves', () => {
    const [m] = groupIntoMeasures([], '4/4');
    expect(shape(m!.treble)).toEqual(['r:w']);
    expect(shape(m!.bass)).toEqual(['r:w']);
  });

  it('inserts rests for gaps and keeps every measure full', () => {
    const measures = groupIntoMeasures([note('C4', 0, 'q'), note('E4', 2, 'q'), note('G4', 5, 'h')], '4/4');
    expect(measures).toHaveLength(2);
    expect(shape(measures[0]!.treble)).toEqual(['C4:q', 'r:q', 'E4:q', 'r:q']);
    expect(shape(measures[1]!.treble)).toEqual(['r:q', 'G4:h', 'r:q']);
    for (const m of measures) {
      expect(total(m.treble)).toBe(4);
      expect(total(m.bass)).toBe(4);
    }
  });

  it('splits notes across treble and bass at middle C and merges chords', () => {
    const [m] = groupIntoMeasures(
      [note('G4', 0, 'h'), note('C4', 0, 'h'), note('E4', 0, 'q'), note('C3', 0, 'w')],
      '4/4',
    );
    expect(shape(m!.treble)).toEqual(['C4+E4+G4:h', 'r:h']);
    expect(m!.treble[0]!.noteIds).toHaveLength(3);
    expect(shape(m!.bass)).toEqual(['C3:w']);
  });

  it('clips notes at the next note and at the barline', () => {
    const measures = groupIntoMeasures([note('C4', 0, 'w'), note('D4', 1, 'q'), note('E4', 2.5, 'w')], '4/4');
    expect(shape(measures[0]!.treble)).toEqual(['C4:q', 'D4:q', 'r:8', 'E4:q.']);
    expect(measures).toHaveLength(1);
  });

  it('uses three quarter beats per measure in 3/4 and 6/8', () => {
    for (const ts of ['3/4', '6/8'] as const) {
      const measures = groupIntoMeasures([note('A4', 3, 'q')], ts, 2);
      expect(measures).toHaveLength(2);
      expect(shape(measures[0]!.treble)).toEqual(['r:h.']);
      expect(shape(measures[1]!.treble)).toEqual(['A4:q', 'r:h']);
    }
  });

  it('snaps start times to the sixteenth-note grid', () => {
    const [m] = groupIntoMeasures([note('C5', 0.3, '16')], '4/4');
    expect(m!.treble[1]).toMatchObject({ kind: 'note', startBeat: 0.25, vfDuration: '16' });
  });
});

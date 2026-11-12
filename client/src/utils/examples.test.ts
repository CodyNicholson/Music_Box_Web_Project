import { describe, expect, it } from 'vitest';
import { EXAMPLES, chordChart, exampleSong, findExample, parseMelody } from './examples';
import { DRUM_SOUNDS, instrument } from './instruments';
import { DURATION_BEATS, beatsPerMeasure, pitchToMidi } from './music';
import { QUANTUM, measureCountFor } from './measures';

describe('parseMelody', () => {
  it('reads pitches, lengths and rests, storing dotted lengths as the next longer value', () => {
    expect(parseMelody('r:q C4:q. D4:8 | E4:8. F4:16 G4:h', 2)).toEqual([
      ['C4', 3, 'h'],
      ['D4', 4.5, '8'],
      ['E4', 5, 'q'],
      ['F4', 5.75, '16'],
      ['G4', 6, 'h'],
    ]);
  });

  it('rejects unknown lengths', () => {
    expect(() => parseMelody('C4:x')).toThrow(/C4:x/);
  });
});

describe('chordChart', () => {
  it('splits each bar between its chords and skips pickup bars', () => {
    expect(chordChart('- | Am E | G', '6/8')).toEqual([
      { chord: 'Am', start: 3, beats: 1.5 },
      { chord: 'E', start: 4.5, beats: 1.5 },
      { chord: 'G', start: 6, beats: 3 },
    ]);
  });

  it('rejects unknown chords', () => {
    expect(() => chordChart('C | Xm', '4/4')).toThrow(/Xm/);
  });
});

describe('example songs', () => {
  it('each uses its own set of instruments', () => {
    const sets = EXAMPLES.map((e) => e.build().tracks.map((t) => t.instrument).sort().join(','));
    expect(new Set(sets).size).toBe(EXAMPLES.length);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(6);
  });

  it('defaults to Ode to Joy and builds fresh copies', () => {
    expect(exampleSong().title).toBe('Ode to Joy');
    expect(exampleSong('nope').title).toBe('Ode to Joy');
    expect(findExample('saints')?.title).toBe('When the Saints Go Marching In');
    expect(exampleSong('saints').tracks[0]!.notes[0]!.id).not.toBe(exampleSong('saints').tracks[0]!.notes[0]!.id);
  });

  for (const example of EXAMPLES) {
    describe(example.title, () => {
      const song = example.build();

      it('matches its listing and stays within the save limits', () => {
        expect(song.title).toBe(example.title);
        expect(song.tracks.length).toBeGreaterThanOrEqual(2);
        expect(song.tracks.length).toBeLessThanOrEqual(12);
        expect(song.tracks.reduce((n, t) => n + t.notes.length, 0)).toBeLessThanOrEqual(5000);
      });

      it('keeps every note playable on its instrument and on the beat grid', () => {
        for (const t of song.tracks) {
          const def = instrument(t.instrument);
          const [low, high] = def.range.map(pitchToMidi) as [number, number];
          for (const n of t.notes) {
            if (def.kind === 'drums') expect(DRUM_SOUNDS.map((d) => d.pitch)).toContain(n.pitch);
            else expect(pitchToMidi(n.pitch), `${t.name} ${n.pitch}`).toBeGreaterThanOrEqual(low);
            if (def.kind !== 'drums') expect(pitchToMidi(n.pitch), `${t.name} ${n.pitch}`).toBeLessThanOrEqual(high);
            expect(n.startTime / QUANTUM).toBe(Math.round(n.startTime / QUANTUM));
          }
        }
      });

      it('has every track end in the same bar, with no bar overfilled', () => {
        const counts = song.tracks.map((t) => measureCountFor(t.notes, song.timeSignature));
        expect(new Set(counts).size).toBe(1);
        // The melody (first track) never has a note starting before the previous one has had its
        // written length, except where a longer stored value stands for a dotted note.
        const bar = beatsPerMeasure(song.timeSignature);
        const melody = [...song.tracks[0]!.notes].sort((a, b) => a.startTime - b.startTime);
        for (let i = 1; i < melody.length; i++) {
          const prev = melody[i - 1]!;
          const gap = melody[i]!.startTime - prev.startTime;
          expect(gap, `${prev.pitch} at ${prev.startTime}`).toBeGreaterThanOrEqual(DURATION_BEATS[prev.duration] / 2);
          expect(gap).toBeLessThanOrEqual(bar * 2);
        }
      });
    });
  }
});

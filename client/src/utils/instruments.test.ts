import { describe, expect, it } from 'vitest';
import { DRUM_SOUNDS, INSTRUMENTS, defaultTrackName, instrument, pitchLabel } from './instruments';
import { isValidPitch, pitchToMidi } from './music';

describe('instruments', () => {
  it('maps sample files to pitches inside each instrument range', () => {
    for (const def of INSTRUMENTS) {
      expect(isValidPitch(def.defaultPitch)).toBe(true);
      expect(pitchToMidi(def.range[0])).toBeLessThan(pitchToMidi(def.range[1]));
      for (const [pitch, file] of Object.entries(def.sampler?.urls ?? {})) {
        expect(isValidPitch(pitch), `${def.id} ${pitch}`).toBe(true);
        expect(file).toMatch(/^[A-G]s?\d\.mp3$/);
      }
    }
    expect(instrument('violin').sampler!.urls['A#3']).toBeUndefined();
    expect(instrument('bass-guitar').sampler!.urls['A#1']).toBe('As1.mp3');
  });

  const NEW_INSTRUMENTS = ['saxophone', 'trumpet', 'trombone', 'clarinet', 'double-bass', 'dulcimer'] as const;

  it('keeps every pitch in range close to a recorded sample, with the default pitch in range', () => {
    for (const def of NEW_INSTRUMENTS.map(instrument)) {
      const samples = Object.keys(def.sampler!.urls).map(pitchToMidi);
      const [low, high] = def.range.map(pitchToMidi) as [number, number];
      const start = pitchToMidi(def.defaultPitch);
      expect(start, `${def.id} default`).toBeGreaterThanOrEqual(low);
      expect(start, `${def.id} default`).toBeLessThanOrEqual(high);
      for (const k of def.keyboard) expect(k, `${def.id} keyboard`).toMatch(/^C\d$/);
      for (let midi = low; midi <= high; midi++) {
        // Pitch-shifting a sample more than a minor sixth starts to sound like a different instrument.
        const shift = Math.min(...samples.map((s) => Math.abs(s - midi)));
        expect(shift, `${def.id} MIDI ${midi}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('offers the wind, brass, bass and dulcimer instruments', () => {
    const ids = INSTRUMENTS.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([...NEW_INSTRUMENTS]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(instrument('double-bass').staves).toEqual([{ clef: 'bass', octaveDown: true }]);
    expect(instrument('trombone').staves[0]!.clef).toBe('bass');
    expect(instrument('saxophone').sampler!.urls['C#3']).toBe('Cs3.mp3');
    expect(defaultTrackName('double-bass', [])).toBe('Double bass');
  });

  it('gives every drum a unique pitch, staff position and shortcut', () => {
    for (const key of ['pitch', 'staffPitch', 'key'] as const) {
      expect(new Set(DRUM_SOUNDS.map((d) => d[key])).size).toBe(DRUM_SOUNDS.length);
    }
    expect(pitchLabel('drums', 'D2')).toBe('Snare');
    expect(pitchLabel('cello', 'D2')).toBe('D2');
  });

  it('numbers repeated instruments', () => {
    expect(defaultTrackName('violin', [])).toBe('Violin');
    expect(defaultTrackName('violin', [{ name: 'Violin' }])).toBe('Violin 2');
    expect(defaultTrackName('violin', [{ name: 'Violin' }, { name: 'Violin 2' }])).toBe('Violin 3');
  });

  it('falls back to piano for an unknown instrument id', () => {
    expect(instrument('kazoo' as never).id).toBe('piano');
  });
});

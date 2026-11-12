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

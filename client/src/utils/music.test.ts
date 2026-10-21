import { describe, expect, it } from 'vitest';
import { beatsPerMeasure, chordPitches, formatPosition, normalizePitch, pitchRange, pitchToMidi } from './music';

describe('music helpers', () => {
  it('converts pitches to MIDI and normalises flats to sharps', () => {
    expect(pitchToMidi('C4')).toBe(60);
    expect(pitchToMidi('A4')).toBe(69);
    expect(normalizePitch('Bb3')).toBe('A#3');
    expect(pitchRange('C4', 'E4')).toEqual(['C4', 'C#4', 'D4', 'D#4', 'E4']);
  });

  it('measures time signatures in quarter-note beats', () => {
    expect(beatsPerMeasure('4/4')).toBe(4);
    expect(beatsPerMeasure('3/4')).toBe(3);
    expect(beatsPerMeasure('6/8')).toBe(3);
  });

  it('formats bar:beat positions', () => {
    expect(formatPosition(0, '4/4')).toBe('1:1');
    expect(formatPosition(4.5, '4/4')).toBe('2:1.5');
    expect(formatPosition(13.75, '3/4')).toBe('5:2.75');
  });

  it('builds chords up from a root', () => {
    expect(chordPitches('C4', 'maj')).toEqual(['C4', 'E4', 'G4']);
    expect(chordPitches('A3', 'min')).toEqual(['A3', 'C4', 'E4']);
    expect(chordPitches('Bb3', '7')).toEqual(['A#3', 'D4', 'F4', 'G#4']);
    expect(chordPitches('G4', '9')).toEqual(['G4', 'B4', 'D5', 'F5', 'A5']);
    // Notes above the piano's top C are dropped.
    expect(chordPitches('G7', 'maj')).toEqual(['G7', 'B7']);
  });
});

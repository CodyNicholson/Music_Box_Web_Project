import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, trackSchema } from '../src/schemas.js';

// Schema checks only; no database needed.
describe('track schema', () => {
  it.each(['saxophone', 'trumpet', 'trombone', 'clarinet', 'double-bass', 'dulcimer'])('accepts a %s track', (instrument) => {
    const track = { name: 'Lead', instrument, notes: [{ pitch: 'C#3', startTime: 0, duration: 'q' }] };
    expect(trackSchema.safeParse(track).success).toBe(true);
  });

  it('lists each instrument once and still rejects unknown ones', () => {
    expect(new Set(INSTRUMENTS).size).toBe(INSTRUMENTS.length);
    expect(trackSchema.safeParse({ name: 'Kazoo', instrument: 'kazoo', notes: [] }).success).toBe(false);
  });
});

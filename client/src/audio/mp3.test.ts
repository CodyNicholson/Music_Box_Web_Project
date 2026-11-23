import { describe, expect, it } from 'vitest';
import { audibleLength, limitPeak, mp3FileName, peakLevel, toInt16 } from './mp3';
import { encodeMp3 } from './encodeMp3';

function sine(seconds: number, sampleRate: number, freq = 440, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** Offset of the first MPEG audio frame sync (11 set bits), skipping any ID3 tag. */
function firstFrame(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0xff && (bytes[i + 1]! & 0xe0) === 0xe0) return i;
  return -1;
}

describe('mp3FileName', () => {
  it('uses the song title', () => {
    expect(mp3FileName('Ode to Joy')).toBe('Ode to Joy.mp3');
  });
  it('replaces characters file systems reject and collapses spaces', () => {
    expect(mp3FileName('AC/DC: "Live"  <take 2>?')).toBe('AC DC Live take 2.mp3');
  });
  it('falls back for empty or dot-only titles', () => {
    expect(mp3FileName('   ')).toBe('Untitled song.mp3');
    expect(mp3FileName('...')).toBe('Untitled song.mp3');
  });
  it('caps very long titles', () => {
    expect(mp3FileName('x'.repeat(300))).toBe(`${'x'.repeat(100)}.mp3`);
  });
});

describe('toInt16', () => {
  it('maps full scale to the 16-bit range and clamps overs', () => {
    expect([...toInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });
});

describe('limitPeak', () => {
  it('scales a mix that goes past full scale down to the ceiling', () => {
    const l = new Float32Array([0.5, -1.6, 0.2]);
    const r = new Float32Array([1.2, 0, -0.4]);
    limitPeak([l, r], 0.98);
    expect(peakLevel([l, r])).toBeCloseTo(0.98, 5);
    expect(l[0]! / r[0]!).toBeCloseTo(0.5 / 1.2, 5); // balance between channels kept
  });
  it('never turns a quiet mix up', () => {
    const ch = new Float32Array([0.1, -0.3]);
    limitPeak([ch]);
    expect([...ch]).toEqual([...new Float32Array([0.1, -0.3])]);
  });
});

describe('audibleLength', () => {
  it('cuts trailing silence after the last audible sample on any channel, plus padding', () => {
    const l = new Float32Array(100);
    const r = new Float32Array(100);
    l[10] = 0.5;
    r[40] = 0.01;
    l[80] = 0.0001; // below the threshold
    expect(audibleLength([l, r], 0.0005, 5)).toBe(46);
  });
  it('never cuts before the minimum length or past the end', () => {
    const ch = new Float32Array(100);
    ch[5] = 1;
    expect(audibleLength([ch], 0.0005, 0, 60)).toBe(60);
    expect(audibleLength([ch], 0.0005, 500)).toBe(100);
  });
});

describe('encodeMp3', () => {
  it('encodes stereo audio into MP3 frames at the requested bitrate', () => {
    const rate = 44100;
    const progress: number[] = [];
    const parts = encodeMp3([sine(2, rate), sine(2, rate, 660)], rate, 192, (f) => progress.push(f));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((offset, p) => (bytes.set(p, offset), offset + p.length), 0);

    const frame = firstFrame(bytes);
    expect(frame).toBeGreaterThanOrEqual(0);
    // MPEG-1 Layer III header: version bits 11, layer bits 01.
    expect((bytes[frame + 1]! >> 3) & 0b11).toBe(0b11);
    expect((bytes[frame + 1]! >> 1) & 0b11).toBe(0b01);
    // Constant 192 kbps: about 48 kB for 2 seconds.
    expect(bytes.length).toBeGreaterThan(44_000);
    expect(bytes.length).toBeLessThan(54_000);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('encodes mono and rejects more than two channels', () => {
    const rate = 22050;
    expect(encodeMp3([sine(0.5, rate)], rate, 64).length).toBeGreaterThan(0);
    expect(() => encodeMp3([sine(0.1, rate), sine(0.1, rate), sine(0.1, rate)], rate)).toThrow(/mono or stereo/);
  });
});

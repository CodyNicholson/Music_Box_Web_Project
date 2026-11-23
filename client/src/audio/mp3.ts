/** Pure audio helpers for MP3 export. The encoder itself is in encodeMp3.ts, loaded only by the worker. */

export const MP3_KBPS = 192;
/** Peak level exports are limited to, just under full scale so the MP3 decoder never clips. */
export const PEAK_CEILING = 0.98;
/** Below this level (about -66 dBFS) a song's tail counts as silence and is trimmed. */
export const SILENCE_LEVEL = 0.0005;

/** Download name for a song: its title with characters file systems reject removed. */
export function mp3FileName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100)
    .trim();
  return `${base || 'Untitled song'}.mp3`;
}

/** Float samples (-1..1) to 16-bit PCM, clamped. */
export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Highest absolute sample value across all channels. */
export function peakLevel(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]!);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Scales the mix down (never up) so its loudest sample sits at `ceiling`. Several loud tracks can
 * add up past full scale, which the speakers would clip; an export stays clean instead.
 */
export function limitPeak(channels: Float32Array[], ceiling = PEAK_CEILING): void {
  const peak = peakLevel(channels);
  if (peak <= ceiling) return;
  const gain = ceiling / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i]! *= gain;
}

/**
 * Number of samples to keep so the reverb tail ends where it becomes inaudible instead of leaving
 * seconds of silence: everything up to the last sample louder than `threshold`, plus `padding`.
 * Never cuts before `minLength`.
 */
export function audibleLength(channels: Float32Array[], threshold = SILENCE_LEVEL, padding = 0, minLength = 0): number {
  const length = channels[0]?.length ?? 0;
  let last = -1;
  for (const ch of channels) {
    for (let i = length - 1; i > last; i--) {
      if (Math.abs(ch[i]!) > threshold) {
        last = i;
        break;
      }
    }
  }
  return Math.min(length, Math.max(minLength, last + 1 + padding));
}

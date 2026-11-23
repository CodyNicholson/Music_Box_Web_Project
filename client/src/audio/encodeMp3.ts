import { Mp3Encoder } from '@breezystack/lamejs';
import { MP3_KBPS, toInt16 } from './mp3';

/** Samples per MPEG-1 Layer III frame; lamejs encodes most efficiently in multiples of it. */
const FRAME = 1152;
const CHUNK = FRAME * 32;

/**
 * Encodes mono or stereo float audio as a constant-bitrate MP3. `onProgress` gets 0..1 as chunks
 * are encoded.
 */
export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  kbps = MP3_KBPS,
  onProgress?: (fraction: number) => void,
): Uint8Array<ArrayBuffer>[] {
  if (channels.length < 1 || channels.length > 2) throw new Error('MP3 export supports mono or stereo audio');
  const stereo = channels.length === 2;
  const encoder = new Mp3Encoder(channels.length, sampleRate, kbps);
  const left = toInt16(channels[0]!);
  const right = stereo ? toInt16(channels[1]!) : undefined;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const keep = (bytes: Uint8Array) => {
    // lamejs reuses its output buffer between calls, so copy each chunk out.
    if (bytes.length > 0) parts.push(new Uint8Array(bytes));
  };

  for (let i = 0; i < left.length; i += CHUNK) {
    keep(encoder.encodeBuffer(left.subarray(i, i + CHUNK), right?.subarray(i, i + CHUNK)));
    onProgress?.(Math.min(1, (i + CHUNK) / left.length));
  }
  keep(encoder.flush());
  return parts;
}

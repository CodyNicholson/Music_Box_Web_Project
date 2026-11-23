import * as Tone from 'tone';
import type { InstrumentId, Song } from '@/types/music';
import { DURATION_BEATS, songLengthBeats } from '@/utils/music';
import { createVoice, loadSamples, ROOM_REVERB } from './voices';
import { audibleLength, limitPeak } from './mp3';

export const EXPORT_SAMPLE_RATE = 44100;
/**
 * Seconds rendered past the last written note so ringing strings, cymbals and the room reverb can
 * die away. Generous on purpose: the silent part is trimmed off again afterwards.
 */
const TAIL_SECONDS = 6;
/** Silence kept after the tail fades below audibility. */
const END_PADDING_SECONDS = 0.25;

/** Tracks that make a sound in an export: muted and silent tracks are left out, as in playback. */
export function audibleTracks(song: Song) {
  return song.tracks.filter((t) => !t.muted && t.volume > 0 && t.notes.length > 0);
}

/**
 * Renders a song to stereo audio faster than real time, in an offline audio context with the same
 * instruments, ring-out and room reverb as live playback. Independent of the live Transport, so the
 * studio can keep playing while a song exports.
 *
 * Returns one Float32Array per channel, peak-limited and with trailing silence trimmed.
 */
export async function renderSong(song: Song, sampleRate = EXPORT_SAMPLE_RATE): Promise<Float32Array[]> {
  const tracks = audibleTracks(song);
  if (tracks.length === 0) throw new Error('Nothing to export: add some notes, or unmute a track.');

  const instruments = [...new Set<InstrumentId>(tracks.map((t) => t.instrument))];
  await Promise.all(instruments.map(loadSamples));

  const secondsPerBeat = 60 / song.bpm;
  const songSeconds = songLengthBeats(tracks.flatMap((t) => t.notes)) * secondsPerBeat;
  const context = new Tone.OfflineContext(2, songSeconds + TAIL_SECONDS, sampleRate);

  // Every node is created with an explicit context, so the page's live audio graph is never touched.
  const room = new Tone.Reverb({ context, ...ROOM_REVERB }).toDestination();
  await room.ready;

  for (const track of tracks) {
    const voice = createVoice(track.instrument, room, context);
    for (const note of track.notes) {
      voice.play(
        note.pitch,
        DURATION_BEATS[note.duration] * secondsPerBeat,
        note.startTime * secondsPerBeat,
        (note.velocity ?? 0.8) * track.volume,
      );
    }
  }

  const rendered = (await context.render()).get();
  context.dispose();
  if (!rendered) throw new Error('The audio could not be rendered.');

  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i));
  limitPeak(channels);
  const length = audibleLength(
    channels,
    undefined,
    Math.round(END_PADDING_SECONDS * sampleRate),
    Math.round(songSeconds * sampleRate),
  );
  return channels.map((ch) => ch.slice(0, length));
}

import * as Tone from 'tone';
import type { InstrumentId } from '@/types/music';
import { instrument } from '@/utils/instruments';

/**
 * Instrument sounds shared by live playback (useAudioEngine) and MP3 export (renderSong). Samples
 * are downloaded once and reused by every audio context, so an export plays exactly the same
 * recordings, tails and room as the Play button.
 */

/** What a song needs from an instrument: sustained notes for pitched ones, one-shots for drums. */
export interface InstrumentVoice {
  play(pitch: string, seconds: number, time: number, velocity: number): void;
  attack(pitch: string, time: number, velocity: number): void;
  release(pitch: string, time: number): void;
  releaseAll(): void;
}

/** Shared room ambience every instrument plays through, so notes carry into the room and fade naturally. */
export const ROOM_REVERB = { decay: 2.2, preDelay: 0.012, wet: 0.22 } as const;

/** One file per drum, so nothing is pitch-shifted. The crash cymbal (C#3) is synthesized. */
const DRUM_FILES: Record<string, string> = {
  C2: 'kick.mp3',
  D2: 'snare.mp3',
  'F#2': 'hihat.mp3',
  D3: 'tom1.mp3',
  B2: 'tom2.mp3',
  G2: 'tom3.mp3',
};
const DRUM_BASE_URL = 'https://tonejs.github.io/audio/drum-samples/acoustic-kit/';
/** Fade-out applied when drum hits are cut short by Stop/Pause (Tone.Sampler's `release`). */
const DRUM_RELEASE = 1;
const CRASH_PITCH = 'C#3';

interface SampleSet {
  /** Pitched instruments are keyed by MIDI number, drums by note name. */
  buffers: Tone.ToneAudioBuffers;
  ready: Promise<void>;
}

const sampleSets = new Map<InstrumentId, SampleSet>();

function sampleSet(id: InstrumentId): SampleSet {
  let set = sampleSets.get(id);
  if (set) return set;

  const def = instrument(id);
  const urls =
    id === 'drums'
      ? DRUM_FILES
      : Object.fromEntries(Object.entries(def.sampler!.urls).map(([note, file]) => [Tone.Frequency(note).toMidi(), file]));
  let buffers!: Tone.ToneAudioBuffers;
  const ready = new Promise<void>((resolve, reject) => {
    buffers = new Tone.ToneAudioBuffers({
      urls,
      baseUrl: id === 'drums' ? DRUM_BASE_URL : def.sampler!.baseUrl,
      onload: () => resolve(),
      onerror: (err) => {
        console.error(`Could not load ${def.label} samples`, err);
        // Forget the failed set so the next export (or new voice) downloads it again.
        if (sampleSets.get(id)?.buffers === buffers) sampleSets.delete(id);
        reject(new Error(`Could not load the ${def.label.toLowerCase()} samples. Check your connection and try again.`));
      },
    });
  });
  ready.catch(() => {}); // callers that care attach their own handler
  set = { buffers, ready };
  sampleSets.set(id, set);
  return set;
}

/** Starts downloading an instrument's samples (once) and resolves when they are decoded. */
export function loadSamples(id: InstrumentId): Promise<void> {
  return sampleSet(id).ready;
}

/**
 * A sampled, pitched instrument. Plays the nearest recorded sample, pitch-shifted to the note, like
 * Tone.Sampler, but keeps its own record of what is sounding. Tone.Sampler's release re-stops every
 * source of that pitch, including ones already fading out, and re-stopping cancels the fade, so
 * long, overlapping tails would jump back to full volume.
 */
function samplerVoice(id: InstrumentId, destination: Tone.InputNode, context: Tone.BaseContext): InstrumentVoice {
  const { urls, ring, release } = instrument(id).sampler!;
  const { buffers } = sampleSet(id);
  const sampleMidis = Object.keys(urls).map((note) => Tone.Frequency(note).toMidi());
  const output = new Tone.Gain({ context }).connect(destination);

  /** The most recent sound for each pitch, and when it starts (or started) to fade out. */
  const sounding = new Map<number, { source: Tone.ToneBufferSource; releaseAt: number }>();

  /** Starts the fade-out at `time`, unless this pitch is already fading by then. */
  function damp(midi: number, time: number) {
    const entry = sounding.get(midi);
    if (!entry || entry.releaseAt <= time) return;
    entry.source.stop(time);
    entry.releaseAt = time;
  }

  function strike(pitch: string, time: number, velocity: number, releaseAt = Infinity) {
    if (!buffers.loaded) return;
    const midi = Tone.Frequency(pitch).toMidi();
    // Striking the same pitch again damps the sound still ringing from the last time it was played
    // (like a re-struck piano key or a re-plucked string) instead of stacking a second copy on top.
    damp(midi, time);
    const closest = sampleMidis.reduce((best, m) => (Math.abs(m - midi) < Math.abs(best - midi) ? m : best));
    const buffer = buffers.get(closest);
    const playbackRate = Tone.intervalToFrequencyRatio(midi - closest);
    const source = new Tone.ToneBufferSource({ context, url: buffer, playbackRate, fadeOut: release, curve: 'exponential' }).connect(
      output,
    );
    const naturalEnd = time + buffer.duration / playbackRate;
    source.start(time, 0, buffer.duration / playbackRate, velocity);
    if (releaseAt < naturalEnd) source.stop(releaseAt);
    const entry = { source, releaseAt: Math.min(releaseAt, naturalEnd) };
    sounding.set(midi, entry);
    source.onended = () => {
      if (sounding.get(midi) === entry) sounding.delete(midi);
    };
  }

  return {
    // Let the note ring past its written length so it overlaps naturally with the next one.
    play: (pitch, seconds, time, velocity) => strike(pitch, time, velocity, time + seconds + ring),
    attack: (pitch, time, velocity) => strike(pitch, time, velocity),
    release: (pitch, time) => damp(Tone.Frequency(pitch).toMidi(), time),
    releaseAll: () => {
      const now = context.immediate();
      sounding.forEach((_, midi) => damp(midi, now));
    },
  };
}

/**
 * Acoustic drum kit: sampled kick, snare, hi-hat and toms and a synthesized crash cymbal. Hits ring
 * out regardless of the written length, and overlapping hits of the same drum stack.
 */
function drumVoice(destination: Tone.InputNode, context: Tone.BaseContext): InstrumentVoice {
  const { buffers } = sampleSet('drums');
  const sounding = new Set<Tone.ToneBufferSource>();
  const crash = new Tone.MetalSynth({
    context,
    envelope: { attack: 0.001, decay: 1.6, release: 0.4 },
    harmonicity: 5.1,
    modulationIndex: 40,
    resonance: 5000,
    octaves: 1.2,
    volume: -16,
  }).connect(destination);

  const hit = (pitch: string, time: number, velocity: number) => {
    if (pitch === CRASH_PITCH) {
      crash.triggerAttackRelease(320, 1.6, time, velocity);
      return;
    }
    if (!(pitch in DRUM_FILES) || !buffers.loaded) return;
    const source = new Tone.ToneBufferSource({ context, url: buffers.get(pitch), fadeOut: DRUM_RELEASE, curve: 'exponential' }).connect(
      destination,
    );
    source.start(time, 0, undefined, velocity);
    sounding.add(source);
    source.onended = () => sounding.delete(source);
  };

  return {
    play: (pitch, _seconds, time, velocity) => hit(pitch, time, velocity),
    attack: hit,
    release: () => {},
    releaseAll: () => {
      const now = context.immediate();
      sounding.forEach((source) => source.stop(now));
    },
  };
}

/**
 * Builds an instrument in `context` (the live page context or an offline render), sending its sound
 * to `destination`. Notes played before the samples finish downloading are skipped.
 */
export function createVoice(id: InstrumentId, destination: Tone.InputNode, context: Tone.BaseContext = Tone.getContext()): InstrumentVoice {
  return id === 'drums' ? drumVoice(destination, context) : samplerVoice(id, destination, context);
}

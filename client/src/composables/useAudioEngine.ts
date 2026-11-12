import * as Tone from 'tone';
import { computed, reactive, readonly, ref } from 'vue';
import type { InstrumentId, NoteEvent, Song } from '@/types/music';
import { useSongStore } from '@/stores/songStore';
import { DURATION_BEATS, songLengthBeats } from '@/utils/music';
import { instrument } from '@/utils/instruments';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

/** What the engine needs from an instrument: sustained notes for pitched ones, one-shots for drums. */
interface InstrumentVoice {
  play(pitch: string, seconds: number, time: number, velocity: number): void;
  attack(pitch: string, time: number, velocity: number): void;
  release(pitch: string, time: number): void;
  releaseAll(): void;
}

type PartValue = { time: string; trackId: string; note: NoteEvent };

// Module-level singletons: there is one audio graph and one Transport per page,
// so every component calling useAudioEngine() shares the same engine and state.
const state = ref<PlaybackState>('stopped');
const currentBeat = ref(0);
const loaded = reactive(new Set<InstrumentId>());
const failed = reactive(new Set<InstrumentId>());

const voices = new Map<InstrumentId, InstrumentVoice>();
let part: Tone.Part<PartValue> | null = null;
let frameId: number | null = null;
let songEndBeat = 0;

/**
 * Shared room ambience. Every instrument plays through it, so notes carry into the room and fade
 * naturally instead of cutting off dry. Created lazily: Tone needs the audio context first.
 */
let room: Tone.Reverb | null = null;
function roomBus(): Tone.Reverb {
  if (!room) room = new Tone.Reverb({ decay: 2.2, preDelay: 0.012, wet: 0.22 }).toDestination();
  return room;
}

/**
 * A sampled, pitched instrument. Plays the nearest recorded sample, pitch-shifted to the note, like
 * Tone.Sampler, but keeps its own record of what is sounding. Tone.Sampler's release re-stops every
 * source of that pitch, including ones already fading out, and re-stopping cancels the fade, so
 * long, overlapping tails would jump back to full volume.
 */
function samplerVoice(id: InstrumentId): InstrumentVoice {
  const def = instrument(id);
  const { urls, baseUrl, ring, release } = def.sampler!;
  const byMidi = Object.fromEntries(Object.entries(urls).map(([note, file]) => [Tone.Frequency(note).toMidi(), file]));
  const sampleMidis = Object.keys(byMidi).map(Number);
  const buffers = new Tone.ToneAudioBuffers({
    urls: byMidi,
    baseUrl,
    onload: () => loaded.add(id),
    onerror: (err) => {
      console.error(`Could not load ${def.label} samples`, err);
      failed.add(id);
    },
  });
  const output = new Tone.Gain().connect(roomBus());

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
    const source = new Tone.ToneBufferSource({ url: buffer, playbackRate, fadeOut: release, curve: 'exponential' }).connect(output);
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
      const now = Tone.immediate();
      sounding.forEach((_, midi) => damp(midi, now));
    },
  };
}

/**
 * Acoustic drum kit: sampled kick, snare, hi-hat and toms (one file per drum, so nothing is
 * pitch-shifted) and a synthesized crash cymbal. Hits ring out regardless of the written length.
 */
function drumVoice(): InstrumentVoice {
  const files: Record<string, string> = { C2: 'kick.mp3', D2: 'snare.mp3', 'F#2': 'hihat.mp3', D3: 'tom1.mp3', B2: 'tom2.mp3', G2: 'tom3.mp3' };
  const kit = new Tone.Sampler({
    urls: files,
    baseUrl: 'https://tonejs.github.io/audio/drum-samples/acoustic-kit/',
    release: 1,
    onload: () => loaded.add('drums'),
    onerror: (err) => {
      console.error('Could not load drum samples', err);
      failed.add('drums');
    },
  }).connect(roomBus());
  const crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.6, release: 0.4 },
    harmonicity: 5.1,
    modulationIndex: 40,
    resonance: 5000,
    octaves: 1.2,
    volume: -16,
  }).connect(roomBus());
  const hit = (pitch: string, time: number, velocity: number) => {
    if (pitch === 'C#3') crash.triggerAttackRelease(320, 1.6, time, velocity);
    else if (pitch in files) kit.triggerAttack(pitch, time, velocity);
  };
  return {
    play: (pitch, _seconds, time, velocity) => hit(pitch, time, velocity),
    attack: hit,
    release: () => {},
    releaseAll: () => kit.releaseAll(),
  };
}

function getVoice(id: InstrumentId): InstrumentVoice {
  let voice = voices.get(id);
  if (!voice) {
    voice = id === 'drums' ? drumVoice() : samplerVoice(id);
    voices.set(id, voice);
  }
  return voice;
}

/** Converts quarter-note beats to Transport ticks notation, so positions follow live BPM changes. */
function beatsToTicks(beats: number): string {
  return `${Math.round(beats * Tone.getTransport().PPQ)}i`;
}

// Auditioned notes remember the voice that started them, so switching tracks mid-press still releases them.
const held = new Map<string, InstrumentVoice>();

export function useAudioEngine() {
  const store = useSongStore();

  /** Instruments in the current song whose samples are still downloading. */
  const loading = computed(() =>
    [...new Set(store.song.tracks.map((t) => t.instrument))].filter((id) => !loaded.has(id) && !failed.has(id)),
  );

  /** Starts downloading samples early; safe to call before any user gesture. */
  function preload(ids: InstrumentId[]) {
    ids.forEach(getVoice);
  }

  async function play(song: Song) {
    await Tone.start(); // Required by browser autoplay policy
    const transport = Tone.getTransport();

    if (state.value === 'paused') {
      transport.start();
      state.value = 'playing';
      trackPlayhead();
      return;
    }

    stop();
    song.tracks.forEach((t) => getVoice(t.instrument));
    await Promise.all([Tone.loaded(), roomBus().ready]);
    const allNotes = song.tracks.flatMap((t) => t.notes);
    if (allNotes.length === 0) return;

    transport.bpm.value = song.bpm;
    songEndBeat = songLengthBeats(allNotes);

    // Every track's notes go into one Part, so all instruments share the same clock.
    const events: PartValue[] = song.tracks.flatMap((t) =>
      t.notes.map((n) => ({ time: beatsToTicks(n.startTime), trackId: t.id, note: { ...n } })),
    );
    part = new Tone.Part<PartValue>((time, { trackId, note }) => {
      // Looked up at play time, so mute, volume and instrument changes apply during playback.
      const track = store.song.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const seconds = Tone.Ticks(DURATION_BEATS[note.duration] * transport.PPQ).toSeconds();

      // 1. Trigger the instrument on the Web Audio clock
      if (!track.muted) {
        getVoice(track.instrument).play(note.pitch, seconds, time, (note.velocity ?? 0.8) * track.volume);
      }

      // 2. Highlight the key and sheet note on the frame the sound is heard
      Tone.getDraw().schedule(() => store.noteOn(trackId, note.pitch, note.id), time);

      // 3. Remove the highlight when the note ends
      Tone.getDraw().schedule(() => store.noteOff(trackId, note.pitch, note.id), time + seconds);
    }, events).start(0);

    // At the natural end, let the last notes and the room finish ringing rather than cutting them off.
    transport.scheduleOnce((time) => {
      Tone.getDraw().schedule(() => stop({ letRing: true }), time);
    }, beatsToTicks(songEndBeat));

    transport.start('+0.05');
    state.value = 'playing';
    trackPlayhead();
  }

  function releaseAllVoices() {
    voices.forEach((v) => v.releaseAll());
  }

  function pause() {
    if (state.value !== 'playing') return;
    Tone.getTransport().pause();
    releaseAllVoices();
    cancelFrame();
    state.value = 'paused';
  }

  /** Stops playback. Pressing Stop fades notes out; reaching the end of the song lets them ring on. */
  function stop({ letRing = false }: { letRing?: boolean } = {}) {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    part?.dispose();
    part = null;
    Tone.getDraw().cancel(0);
    if (!letRing) releaseAllVoices();
    cancelFrame();
    store.clearActive();
    currentBeat.value = 0;
    state.value = 'stopped';
  }

  /** Applies a tempo change immediately, including mid-playback. */
  function setBpm(bpm: number) {
    if (bpm >= 20 && bpm <= 300) Tone.getTransport().bpm.value = bpm;
  }

  function trackPlayhead() {
    cancelFrame();
    const transport = Tone.getTransport();
    const tick = () => {
      if (state.value !== 'playing') return;
      // Ticks at the audible time (currentTime), not Tone.now(), which runs ahead by the lookahead.
      const beat = transport.getTicksAtTime(Tone.immediate()) / transport.PPQ;
      currentBeat.value = Math.min(Math.max(beat, 0), songEndBeat);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
  }

  function cancelFrame() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }

  /** Press-and-hold auditioning on the active track's instrument (virtual piano or drum pad). */
  async function attack(pitch: string, velocity = 0.8) {
    await Tone.start();
    const track = store.activeTrack;
    store.noteOn(track.id, pitch);
    const voice = getVoice(track.instrument);
    held.set(`${track.id}|${pitch}`, voice);
    if (loaded.has(track.instrument)) voice.attack(pitch, Tone.immediate(), velocity * track.volume);
  }

  function release(pitch: string) {
    for (const [key, voice] of held) {
      const [trackId, heldPitch] = key.split('|') as [string, string];
      if (heldPitch !== pitch) continue;
      held.delete(key);
      store.noteOff(trackId, pitch);
      voice.release(pitch, Tone.immediate());
    }
  }

  return {
    state: readonly(state),
    currentBeat: readonly(currentBeat),
    loading,
    failed: readonly(failed),
    preload,
    play,
    pause,
    stop,
    setBpm,
    attack,
    release,
  };
}

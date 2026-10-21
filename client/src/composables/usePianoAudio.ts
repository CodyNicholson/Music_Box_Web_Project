import * as Tone from 'tone';
import { readonly, ref } from 'vue';
import type { NoteEvent, Song } from '@/types/music';
import { useSongStore } from '@/stores/songStore';
import { DURATION_BEATS, songLengthBeats } from '@/utils/music';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

// Salamander Grand Piano: every minor third from C2 to C7; Tone.Sampler pitch-shifts the rest.
const SAMPLE_URLS: Record<string, string> = { C7: 'C7.mp3' };
for (let octave = 2; octave <= 6; octave++) {
  SAMPLE_URLS[`C${octave}`] = `C${octave}.mp3`;
  SAMPLE_URLS[`D#${octave}`] = `Ds${octave}.mp3`;
  SAMPLE_URLS[`F#${octave}`] = `Fs${octave}.mp3`;
  SAMPLE_URLS[`A${octave}`] = `A${octave}.mp3`;
}

type PartValue = { time: string; note: NoteEvent };

// Module-level singletons: there is one audio graph and one Transport per page,
// so every component calling usePianoAudio() shares the same engine and state.
const state = ref<PlaybackState>('stopped');
const currentBeat = ref(0);
const samplesLoaded = ref(false);

let sampler: Tone.Sampler | null = null;
let part: Tone.Part<PartValue> | null = null;
let frameId: number | null = null;
let songEndBeat = 0;

function getSampler(): Tone.Sampler {
  if (!sampler) {
    sampler = new Tone.Sampler({
      urls: SAMPLE_URLS,
      baseUrl: 'https://tonejs.github.io/audio/salamander/',
      release: 1,
      onload: () => (samplesLoaded.value = true),
    }).toDestination();
  }
  return sampler;
}

/** Converts quarter-note beats to Transport ticks notation, so positions follow live BPM changes. */
function beatsToTicks(beats: number): string {
  return `${Math.round(beats * Tone.getTransport().PPQ)}i`;
}

export function usePianoAudio() {
  const store = useSongStore();

  /** Starts downloading samples early; safe to call before any user gesture. */
  function preload() {
    getSampler();
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
    const piano = getSampler();
    await Tone.loaded();
    if (song.notes.length === 0) return;

    transport.bpm.value = song.bpm;
    songEndBeat = songLengthBeats(song.notes);

    const events: PartValue[] = song.notes.map((n) => ({ time: beatsToTicks(n.startTime), note: { ...n } }));
    part = new Tone.Part<PartValue>((time, { note }) => {
      const seconds = Tone.Ticks(DURATION_BEATS[note.duration] * transport.PPQ).toSeconds();

      // 1. Trigger piano audio on the Web Audio clock
      piano.triggerAttackRelease(note.pitch, seconds, time, note.velocity ?? 0.8);

      // 2. Highlight the piano key and sheet note on the frame the sound is heard
      Tone.getDraw().schedule(() => store.noteOn(note.pitch, note.id), time);

      // 3. Remove the highlight when the note ends
      Tone.getDraw().schedule(() => store.noteOff(note.pitch, note.id), time + seconds);
    }, events).start(0);

    transport.scheduleOnce((time) => {
      Tone.getDraw().schedule(() => stop(), time);
    }, beatsToTicks(songEndBeat));

    transport.start('+0.05');
    state.value = 'playing';
    trackPlayhead();
  }

  function pause() {
    if (state.value !== 'playing') return;
    Tone.getTransport().pause();
    sampler?.releaseAll();
    cancelFrame();
    state.value = 'paused';
  }

  function stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    part?.dispose();
    part = null;
    Tone.getDraw().cancel(0);
    sampler?.releaseAll();
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

  /** Press-and-hold auditioning for the virtual piano. */
  async function attack(pitch: string, velocity = 0.8) {
    await Tone.start();
    store.noteOn(pitch);
    const piano = getSampler();
    if (samplesLoaded.value) piano.triggerAttack(pitch, Tone.immediate(), velocity);
  }

  function release(pitch: string) {
    store.noteOff(pitch);
    if (samplesLoaded.value) sampler?.triggerRelease(pitch, Tone.immediate());
  }

  return {
    state: readonly(state),
    currentBeat: readonly(currentBeat),
    samplesLoaded: readonly(samplesLoaded),
    preload,
    play,
    pause,
    stop,
    setBpm,
    attack,
    release,
  };
}

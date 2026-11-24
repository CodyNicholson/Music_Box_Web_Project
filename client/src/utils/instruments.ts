import type { InstrumentId, Track } from '@/types/music';

export type StaffClef = 'treble' | 'bass' | 'percussion';

/** One staff an instrument is written on. */
export interface StaffDef {
  clef: StaffClef;
  /**
   * Written an octave above how it sounds, with a small "8" under the clef. Guitars and bass guitar
   * are notated this way so their low notes don't need a forest of ledger lines.
   */
  octaveDown?: boolean;
  /** For instruments with more than one staff: which notes (by sounding MIDI number) go on this one. */
  accepts?: (midi: number) => boolean;
}

/** One piece of the drum kit, stored as its General MIDI drum note. */
export interface DrumSound {
  pitch: string;
  name: string;
  /** Computer-keyboard shortcut on the drum pad. */
  key: string;
  /** Where it sits on the percussion staff (standard drum-set notation). */
  staffPitch: string;
  /** VexFlow notehead type; cymbals use an x. */
  head?: 'x2';
}

interface SamplerConfig {
  baseUrl: string;
  urls: Record<string, string>;
  /**
   * Seconds a played note keeps sounding past its written length before it starts to fade, the way
   * a piano string or guitar string keeps ringing for a moment after the next note is struck.
   * Bowed and wind instruments stop when the player does, so theirs is close to zero.
   */
  ring: number;
  /**
   * Tone.Sampler fade-out length in seconds. Tone fades exponentially with a time constant of
   * ln(release + 1) / ln(200), so 1 s dies away in about 0.3 s; these values are set for the tail
   * length that sounds natural for each instrument, not the literal fade time.
   */
  release: number;
}

export interface InstrumentDef {
  id: InstrumentId;
  label: string;
  icon: string;
  kind: 'pitched' | 'drums';
  staves: StaffDef[];
  /** Lowest and highest pitch offered in the note editor (sounding pitch). */
  range: [low: string, high: string];
  /** Range of the on-screen keyboard; starts and ends on a C so the octave shortcuts line up. */
  keyboard: [low: string, high: string];
  defaultPitch: string;
  sampler?: SamplerConfig;
}

// Keep in sync with DRUM_PITCHES in server/src/schemas.ts.
export const DRUM_SOUNDS: DrumSound[] = [
  { pitch: 'C2', name: 'Kick', key: 'a', staffPitch: 'F4' },
  { pitch: 'D2', name: 'Snare', key: 's', staffPitch: 'C5' },
  { pitch: 'F#2', name: 'Hi-hat', key: 'd', staffPitch: 'G5', head: 'x2' },
  { pitch: 'C#3', name: 'Crash', key: 'f', staffPitch: 'A5', head: 'x2' },
  { pitch: 'D3', name: 'High tom', key: 'g', staffPitch: 'E5' },
  { pitch: 'B2', name: 'Mid tom', key: 'h', staffPitch: 'D5' },
  { pitch: 'G2', name: 'Floor tom', key: 'j', staffPitch: 'A4' },
];

export function drumSound(pitch: string): DrumSound | undefined {
  return DRUM_SOUNDS.find((d) => d.pitch === pitch);
}

/** "As2" (the sample file naming) -> "A#2". */
function sampleUrls(files: string[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f.replace('s', '#'), `${f}.mp3`]));
}

// Salamander Grand Piano: every minor third from C2 to C7; Tone.Sampler pitch-shifts the rest.
const PIANO_URLS: Record<string, string> = { C7: 'C7.mp3' };
for (let octave = 2; octave <= 6; octave++) {
  PIANO_URLS[`C${octave}`] = `C${octave}.mp3`;
  PIANO_URLS[`D#${octave}`] = `Ds${octave}.mp3`;
  PIANO_URLS[`F#${octave}`] = `Fs${octave}.mp3`;
  PIANO_URLS[`A${octave}`] = `A${octave}.mp3`;
}

// Samples from nbrosowsky/tonejs-instruments (CC-BY 3.0), served from GitHub Pages.
const TONEJS_INSTRUMENTS = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

// General MIDI soundfont renders from gleitz/midi-js-soundfonts (FluidR3 GM, MIT), for instruments
// tonejs-instruments doesn't have. Their files use flats ("Eb4"), so only natural notes are listed.
const GM_SOUNDFONT = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';

const SPLIT_MIDI = 60; // middle C: piano notes from here up go on the treble staff

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: 'piano',
    label: 'Piano',
    icon: '🎹',
    kind: 'pitched',
    staves: [
      { clef: 'treble', accepts: (m) => m >= SPLIT_MIDI },
      { clef: 'bass', accepts: (m) => m < SPLIT_MIDI },
    ],
    range: ['C2', 'C7'],
    keyboard: ['C3', 'C6'],
    defaultPitch: 'C4',
    sampler: { baseUrl: 'https://tonejs.github.io/audio/salamander/', urls: PIANO_URLS, ring: 0.35, release: 2.5 },
  },
  {
    id: 'acoustic-guitar',
    label: 'Acoustic guitar',
    icon: '🎸',
    kind: 'pitched',
    staves: [{ clef: 'treble', octaveDown: true }],
    range: ['E2', 'E6'],
    keyboard: ['C2', 'C5'],
    defaultPitch: 'E3',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}guitar-acoustic/`,
      urls: sampleUrls(['D2', 'E2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'D5']),
      ring: 0.8,
      release: 3,
    },
  },
  {
    id: 'electric-guitar',
    label: 'Electric guitar',
    icon: '🎸',
    kind: 'pitched',
    staves: [{ clef: 'treble', octaveDown: true }],
    range: ['E2', 'E6'],
    keyboard: ['C2', 'C5'],
    defaultPitch: 'E3',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}guitar-electric/`,
      urls: sampleUrls(['E2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6']),
      ring: 0.6,
      release: 2.5,
    },
  },
  {
    id: 'bass-guitar',
    label: 'Bass guitar',
    icon: '🎸',
    kind: 'pitched',
    staves: [{ clef: 'bass', octaveDown: true }],
    range: ['E1', 'G4'],
    keyboard: ['C1', 'C4'],
    defaultPitch: 'E2',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}bass-electric/`,
      urls: sampleUrls(['E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4']),
      ring: 0.4,
      release: 2,
    },
  },
  {
    id: 'violin',
    label: 'Violin',
    icon: '🎻',
    kind: 'pitched',
    staves: [{ clef: 'treble' }],
    range: ['G3', 'C7'],
    keyboard: ['C4', 'C7'],
    defaultPitch: 'A4',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}violin/`,
      urls: sampleUrls(['G3', 'A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6', 'A6', 'C7']),
      ring: 0.1,
      release: 1.5,
    },
  },
  {
    id: 'cello',
    label: 'Cello',
    icon: '🎻',
    kind: 'pitched',
    staves: [{ clef: 'bass' }],
    range: ['C2', 'A5'],
    keyboard: ['C2', 'C5'],
    defaultPitch: 'C3',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}cello/`,
      // The cello set has no F#2 sample, so F2 stands in for it.
      urls: sampleUrls(['C2', 'Ds2', 'F2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5']),
      ring: 0.15,
      release: 1.8,
    },
  },
  {
    id: 'double-bass',
    label: 'Double bass',
    icon: '🎻',
    kind: 'pitched',
    // Written an octave above how it sounds, like the bass guitar.
    staves: [{ clef: 'bass', octaveDown: true }],
    range: ['E1', 'G4'],
    keyboard: ['C1', 'C4'],
    defaultPitch: 'E2',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}contrabass/`,
      urls: sampleUrls(['Fs1', 'G1', 'As1', 'C2', 'D2', 'E2', 'Fs2', 'Gs2', 'A2', 'Cs3', 'E3', 'Gs3', 'B3']),
      ring: 0.2,
      release: 1.8,
    },
  },
  {
    id: 'flute',
    label: 'Flute',
    icon: '🪈',
    kind: 'pitched',
    staves: [{ clef: 'treble' }],
    range: ['C4', 'C7'],
    keyboard: ['C4', 'C7'],
    defaultPitch: 'C5',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}flute/`,
      urls: sampleUrls(['C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6', 'C7']),
      ring: 0.05,
      release: 1,
    },
  },
  // Clarinet, saxophone, trumpet and trombone are written at sounding (concert) pitch, like every
  // other staff in the score, rather than transposed for a B-flat or E-flat part.
  {
    id: 'clarinet',
    label: 'Clarinet',
    icon: '🪈',
    kind: 'pitched',
    staves: [{ clef: 'treble' }],
    range: ['D3', 'A#6'],
    keyboard: ['C3', 'C6'],
    defaultPitch: 'G4',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}clarinet/`,
      urls: sampleUrls(['D3', 'F3', 'As3', 'D4', 'F4', 'As4', 'D5', 'F5', 'As5', 'D6', 'Fs6']),
      ring: 0.05,
      release: 1,
    },
  },
  {
    id: 'saxophone',
    label: 'Saxophone',
    icon: '🎷',
    kind: 'pitched',
    staves: [{ clef: 'treble' }],
    // Alto saxophone.
    range: ['C#3', 'A5'],
    keyboard: ['C3', 'C6'],
    defaultPitch: 'D4',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}saxophone/`,
      urls: sampleUrls(['Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4', 'As4', 'Cs5', 'E5', 'G5', 'A5']),
      ring: 0.05,
      release: 1,
    },
  },
  {
    id: 'trumpet',
    label: 'Trumpet',
    icon: '🎺',
    kind: 'pitched',
    staves: [{ clef: 'treble' }],
    range: ['F#3', 'D6'],
    keyboard: ['C3', 'C6'],
    defaultPitch: 'G4',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}trumpet/`,
      urls: sampleUrls(['F3', 'A3', 'C4', 'Ds4', 'F4', 'G4', 'As4', 'D5', 'F5', 'A5', 'C6']),
      ring: 0.05,
      release: 1,
    },
  },
  {
    id: 'trombone',
    label: 'Trombone',
    icon: '🎺',
    kind: 'pitched',
    staves: [{ clef: 'bass' }],
    range: ['E2', 'C5'],
    keyboard: ['C2', 'C5'],
    defaultPitch: 'F3',
    sampler: {
      baseUrl: `${TONEJS_INSTRUMENTS}trombone/`,
      urls: sampleUrls(['Ds2', 'F2', 'Gs2', 'As2', 'C3', 'D3', 'Ds3', 'F3', 'Gs3', 'As3', 'C4', 'D4', 'F4']),
      ring: 0.05,
      release: 1.2,
    },
  },
  {
    id: 'dulcimer',
    label: 'Dulcimer',
    icon: '🪕',
    kind: 'pitched',
    // Hammered dulcimer (General MIDI program 16): struck strings that ring on, like a piano.
    staves: [{ clef: 'treble' }],
    range: ['C3', 'E6'],
    keyboard: ['C3', 'C6'],
    defaultPitch: 'D4',
    sampler: {
      baseUrl: `${GM_SOUNDFONT}dulcimer-mp3/`,
      urls: sampleUrls(['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'E6']),
      ring: 1,
      release: 3,
    },
  },
  {
    id: 'drums',
    label: 'Drums',
    icon: '🥁',
    kind: 'drums',
    staves: [{ clef: 'percussion' }],
    range: ['C2', 'D3'],
    keyboard: ['C2', 'D3'],
    defaultPitch: 'C2',
  },
];

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

export function instrument(id: InstrumentId): InstrumentDef {
  return BY_ID.get(id) ?? BY_ID.get('piano')!;
}

/** Name for a new track: the instrument's label, numbered if the song already has one ("Violin 2"). */
export function defaultTrackName(id: InstrumentId, tracks: Pick<Track, 'name'>[]): string {
  const base = instrument(id).label;
  const names = new Set(tracks.map((t) => t.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Human-readable label for a note's pitch on this instrument ("Snare" for drums). */
export function pitchLabel(id: InstrumentId, pitch: string): string {
  return instrument(id).kind === 'drums' ? (drumSound(pitch)?.name ?? pitch) : pitch;
}

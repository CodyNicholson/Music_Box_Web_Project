import type { InstrumentId, NoteDuration, NoteEvent, Song, TimeSignature, Track } from '@/types/music';
import { beatsPerMeasure, generateId, midiToPitch, pitchToMidi } from './music';

/*
 * Sample songs the library offers as starting points. All of them are public-domain tunes, each
 * arranged for a different set of instruments.
 */

type Row = [pitch: string, startTime: number, duration: NoteDuration];

// ---------------------------------------------------------------------------------------------
// Melodies are written as text: "pitch:length" tokens, "r" for a rest, "|" between bars (ignored,
// it is only there to make the bars readable). A dotted length (q., h., 8.) is stored as the next
// longer note value and the sheet draws it as dotted because the following note cuts it short.
// ---------------------------------------------------------------------------------------------

const LENGTHS: Record<string, { beats: number; duration: NoteDuration }> = {
  w: { beats: 4, duration: 'w' },
  'h.': { beats: 3, duration: 'w' },
  h: { beats: 2, duration: 'h' },
  'q.': { beats: 1.5, duration: 'h' },
  q: { beats: 1, duration: 'q' },
  '8.': { beats: 0.75, duration: 'q' },
  '8': { beats: 0.5, duration: '8' },
  '16': { beats: 0.25, duration: '16' },
};

export function parseMelody(text: string, start = 0): Row[] {
  const rows: Row[] = [];
  let beat = start;
  for (const token of text.split(/[\s|]+/).filter(Boolean)) {
    const [pitch, length] = token.split(':') as [string, string | undefined];
    const value = LENGTHS[length ?? ''];
    if (!value) throw new Error(`Bad melody token "${token}"`);
    if (pitch !== 'r') rows.push([pitch, beat, value.duration]);
    beat += value.beats;
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Chords. Each one has a bass root, a close voicing for the piano's right hand and an
// open-position guitar shape (sounding pitches, low string to high).
// ---------------------------------------------------------------------------------------------

interface ChordShape {
  root: string; // octave 2, for bass guitar and cello
  intervals: number[]; // chord tones above the root in semitones, used for bass walks
  keys: string[];
  guitar: string[];
}

const SHAPES: Record<string, ChordShape> = {
  C: { root: 'C2', intervals: [0, 4, 7, 9], keys: ['C4', 'E4', 'G4'], guitar: ['C3', 'E3', 'G3', 'C4', 'E4'] },
  C7: { root: 'C2', intervals: [0, 4, 7, 10], keys: ['A#3', 'C4', 'E4', 'G4'], guitar: ['C3', 'E3', 'A#3', 'C4', 'E4'] },
  D: { root: 'D2', intervals: [0, 4, 7, 9], keys: ['A3', 'D4', 'F#4'], guitar: ['D3', 'A3', 'D4', 'F#4'] },
  D7: { root: 'D2', intervals: [0, 4, 7, 10], keys: ['A3', 'C4', 'F#4'], guitar: ['D3', 'A3', 'C4', 'F#4'] },
  E: { root: 'E2', intervals: [0, 4, 7, 9], keys: ['G#3', 'B3', 'E4'], guitar: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'] },
  Em: { root: 'E2', intervals: [0, 3, 7, 10], keys: ['B3', 'E4', 'G4'], guitar: ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'] },
  F: { root: 'F2', intervals: [0, 4, 7, 9], keys: ['C4', 'F4', 'A4'], guitar: ['F2', 'C3', 'F3', 'A3', 'C4', 'F4'] },
  G: { root: 'G2', intervals: [0, 4, 7, 9], keys: ['B3', 'D4', 'G4'], guitar: ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'] },
  G7: { root: 'G2', intervals: [0, 4, 7, 10], keys: ['B3', 'D4', 'F4'], guitar: ['G2', 'B2', 'D3', 'G3', 'B3', 'F4'] },
  A7: { root: 'A2', intervals: [0, 4, 7, 10], keys: ['A3', 'C#4', 'G4'], guitar: ['A2', 'E3', 'G3', 'C#4', 'E4'] },
  Am: { root: 'A2', intervals: [0, 3, 7, 10], keys: ['A3', 'C4', 'E4'], guitar: ['A2', 'E3', 'A3', 'C4', 'E4'] },
};

function shape(name: string): ChordShape {
  const s = SHAPES[name];
  if (!s) throw new Error(`Unknown chord "${name}"`);
  return s;
}

function transpose(pitch: string, semitones: number): string {
  return midiToPitch(pitchToMidi(pitch) + semitones);
}

interface ChordSpan {
  chord: string;
  start: number;
  beats: number;
}

/**
 * "C | F C | G7" -> one span per chord. Each "|"-separated bar is split evenly between its chords;
 * "-" leaves a bar without a chord (a pickup bar).
 */
export function chordChart(text: string, ts: TimeSignature): ChordSpan[] {
  const barBeats = beatsPerMeasure(ts);
  return text.split('|').flatMap((bar, i) => {
    const chords = bar.trim().split(/\s+/).filter((c) => c && c !== '-');
    const beats = barBeats / Math.max(1, chords.length);
    return chords.map((chord, j) => {
      shape(chord); // throws on a typo in the chart
      return { chord, start: i * barBeats + j * beats, beats };
    });
  });
}

function each(spans: ChordSpan[], fn: (s: ChordShape, span: ChordSpan, last: boolean) => Row[]): Row[] {
  return spans.flatMap((span, i) => fn(shape(span.chord), span, i === spans.length - 1));
}

const chordRows = (pitches: string[], start: number, duration: NoteDuration): Row[] =>
  pitches.map((p) => [p, start, duration] as Row);

// ---------------------------------------------------------------------------------------------
// Drums: kick on 1 and 3, snare on 2 and 4, eighth-note hi-hats, a crash at the top of a phrase,
// an optional tom fill, and a final crash.
// ---------------------------------------------------------------------------------------------

interface DrumOptions {
  bars: number;
  crashBars?: number[];
  fillBars?: number[];
  ending?: boolean;
}

function rockBeat({ bars, crashBars = [0], fillBars = [], ending = true }: DrumOptions): Row[] {
  const rows: Row[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const b = bar * 4;
    if (ending && bar === bars - 1) {
      rows.push(['C2', b, 'q'], ['C#3', b, 'h']);
      continue;
    }
    const crash = crashBars.includes(bar);
    if (crash) rows.push(['C#3', b, 'h']);
    if (fillBars.includes(bar)) {
      rows.push(['C2', b, 'q'], ['D2', b + 1, 'q']);
      rows.push(['D3', b + 2, '8'], ['D3', b + 2.5, '8'], ['B2', b + 3, '8'], ['G2', b + 3.5, '8']);
      for (let e = crash ? 1 : 0; e < 4; e++) rows.push(['F#2', b + e / 2, '8']);
      continue;
    }
    rows.push(['C2', b, 'q'], ['D2', b + 1, 'q'], ['C2', b + 2, 'q'], ['D2', b + 3, 'q']);
    for (let e = crash ? 1 : 0; e < 8; e++) rows.push(['F#2', b + e / 2, '8']);
  }
  return rows;
}

function track(name: string, instrument: InstrumentId, rows: Row[], volume = 0.8): Track {
  const notes: NoteEvent[] = rows.map(([pitch, startTime, duration]) => ({
    id: generateId(),
    pitch,
    startTime,
    duration,
    velocity: 0.8,
  }));
  return { id: generateId(), name, instrument, volume, muted: false, notes };
}

// ---------------------------------------------------------------------------------------------
// Ode to Joy (Beethoven): violin, piano, cello and drums.
// ---------------------------------------------------------------------------------------------

function odeToJoy(): Song {
  const melody = parseMelody(`
    E5:q E5:q F5:q G5:q | G5:q F5:q E5:q D5:q | C5:q C5:q D5:q E5:q | E5:q. D5:8 D5:h |
    E5:q E5:q F5:q G5:q | G5:q F5:q E5:q D5:q | C5:q C5:q D5:q E5:q | D5:q. C5:8 C5:h`);
  // Piano: the chords, right hand around middle C and a bass note in the left hand.
  const chords: [root: string, upper: string[], start: number, duration: NoteDuration][] = [
    ['C3', ['E4', 'G4'], 0, 'w'],
    ['G2', ['D4', 'G4'], 4, 'h'], ['G2', ['B3', 'D4'], 6, 'h'],
    ['C3', ['C4', 'E4'], 8, 'w'],
    ['G2', ['B3', 'D4'], 12, 'w'],
    ['C3', ['E4', 'G4'], 16, 'w'],
    ['G2', ['D4', 'G4'], 20, 'h'], ['G2', ['B3', 'D4'], 22, 'h'],
    ['C3', ['C4', 'E4'], 24, 'w'],
    ['G2', ['B3', 'D4'], 28, 'h'], ['C3', ['C4', 'E4'], 30, 'h'],
  ];
  const piano = chords.flatMap(([root, upper, start, duration]) => chordRows([root, ...upper], start, duration));
  // Cello: the root of each chord on beats 1 and 3.
  const cello = chords.flatMap(([root, , start, duration]): Row[] =>
    duration === 'w' ? [[root, start, 'h'], [root, start + 2, 'h']] : [[root, start, 'h']],
  );

  return {
    title: 'Ode to Joy',
    bpm: 110,
    timeSignature: '4/4',
    tracks: [
      track('Violin', 'violin', melody),
      track('Piano', 'piano', piano, 0.6),
      track('Cello', 'cello', cello, 0.7),
      track('Drums', 'drums', rockBeat({ bars: 8, crashBars: [0, 4], ending: false }), 0.5),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Twinkle, Twinkle, Little Star (traditional): flute and piano, a lullaby.
// ---------------------------------------------------------------------------------------------

function twinkleTwinkle(): Song {
  const verse = `C5:q C5:q G5:q G5:q | A5:q A5:q G5:h | F5:q F5:q E5:q E5:q | D5:q D5:q C5:h |`;
  const melody = parseMelody(`${verse}
    G5:q G5:q F5:q F5:q | E5:q E5:q D5:h | G5:q G5:q F5:q F5:q | E5:q E5:q D5:h |
    ${verse}`);
  const chart = chordChart('C | F C | F C | G C | C F | C G | C F | C G | C | F C | F C | G C', '4/4');

  // Piano: a bass note and a chord every two beats; the last chord rings out.
  const piano = each(chart, (s, { start, beats }, last) =>
    Array.from({ length: beats / 2 }, (_, k) => k).flatMap((k) =>
      chordRows([transpose(s.root, 12), ...s.keys], start + k * 2, last ? 'w' : 'h'),
    ),
  );

  return {
    title: 'Twinkle, Twinkle, Little Star',
    bpm: 96,
    timeSignature: '4/4',
    tracks: [track('Flute', 'flute', melody), track('Piano', 'piano', piano, 0.5)],
  };
}

// ---------------------------------------------------------------------------------------------
// When the Saints Go Marching In (traditional): electric guitar lead, piano, bass guitar, drums.
// ---------------------------------------------------------------------------------------------

function whenTheSaints(): Song {
  const melody = parseMelody(`
    r:q C4:q E4:q F4:q | G4:w | r:q C4:q E4:q F4:q | G4:w |
    r:q C4:q E4:q F4:q | G4:h E4:h | C4:h E4:h | D4:w |
    r:q E4:q E4:q D4:q | C4:h. C4:q | E4:h G4:q G4:q | F4:w |
    r:q E4:q F4:q G4:q | E4:h C4:h | D4:w | C4:w`);
  const chart = chordChart('C | C | C | C | C | C | C | G7 | C | C | C7 | F | C | C | G7 | C', '4/4');

  // Piano, stride style: left-hand root on 1 and 3, right-hand chord on 2 and 4.
  const piano = each(chart, (s, { start }, last) => {
    const low = transpose(s.root, 12);
    if (last) return chordRows([low, ...s.keys], start, 'w');
    return [0, 1, 2, 3].flatMap((k) => (k % 2 === 0 ? chordRows([low], start + k, 'q') : chordRows(s.keys, start + k, 'q')));
  });
  // Bass guitar: a boogie walk up the chord (root, third, fifth, sixth or seventh).
  const bass = each(chart, (s, { start }, last) =>
    last ? [[s.root, start, 'w']] : s.intervals.map((iv, k) => [transpose(s.root, iv), start + k, 'q'] as Row),
  );

  return {
    title: 'When the Saints Go Marching In',
    bpm: 152,
    timeSignature: '4/4',
    tracks: [
      track('Electric guitar', 'electric-guitar', melody, 0.85),
      track('Piano', 'piano', piano, 0.5),
      track('Bass guitar', 'bass-guitar', bass, 0.75),
      track('Drums', 'drums', rockBeat({ bars: 16, crashBars: [0, 8], fillBars: [7] }), 0.5),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Amazing Grace (traditional hymn tune "New Britain"): cello melody, acoustic guitar waltz, 3/4.
// ---------------------------------------------------------------------------------------------

function amazingGrace(): Song {
  const melody = parseMelody(`
    r:h D3:q | G3:h B3:8 G3:8 | B3:h A3:q | G3:h E3:q | D3:h D3:q | G3:h B3:8 G3:8 | B3:h A3:q | D4:h B3:q |
    D4:h B3:8 G3:8 | B3:h A3:q | G3:h E3:q | D3:h D3:q | G3:h B3:8 G3:8 | B3:h A3:q | G3:h.`);
  const chart = chordChart('- | G | G | C | G | G | G | D | G | G | C | G | Em | D | G', '3/4');

  // Acoustic guitar: bass note on beat 1, strummed chord on beats 2 and 3; the last chord rings out.
  const guitar = each(chart, (s, { start }, last) => {
    const [bassNote, ...upper] = s.guitar as [string, ...string[]];
    if (last) return chordRows(s.guitar, start, 'w');
    return [[bassNote, start, 'q'] as Row, ...chordRows(upper.slice(-4), start + 1, 'q'), ...chordRows(upper.slice(-4), start + 2, 'q')];
  });

  return {
    title: 'Amazing Grace',
    bpm: 76,
    timeSignature: '3/4',
    tracks: [track('Cello', 'cello', melody, 0.85), track('Acoustic guitar', 'acoustic-guitar', guitar, 0.6)],
  };
}

// ---------------------------------------------------------------------------------------------
// Jingle Bells (James Lord Pierpont), the chorus: violin, acoustic guitar, bass guitar and drums.
// ---------------------------------------------------------------------------------------------

function jingleBells(): Song {
  const jingle = `B4:q B4:q B4:h | B4:q B4:q B4:h | B4:q D5:q G4:q. A4:8 | B4:w |
    C5:q C5:q C5:q. C5:8 | C5:q B4:q B4:q B4:8 B4:8 |`;
  const melody = parseMelody(`${jingle} B4:q A4:q A4:q B4:q | A4:h D5:h |
    ${jingle} D5:q D5:q C5:q A4:q | G4:w`);
  const chart = chordChart('G | G | G | G | C | G | A7 | D7 | G | G | G | G | C | G | D7 | G', '4/4');

  // Acoustic guitar: a strum on every beat.
  const guitar = each(chart, (s, { start }, last) =>
    last ? chordRows(s.guitar, start, 'w') : [0, 1, 2, 3].flatMap((k) => chordRows(s.guitar, start + k, 'q')),
  );
  // Bass guitar: root on beat 1, fifth on beat 3.
  const bass = each(chart, (s, { start }, last) =>
    last ? [[s.root, start, 'w']] : [[s.root, start, 'h'] as Row, [transpose(s.root, 7), start + 2, 'h'] as Row],
  );

  return {
    title: 'Jingle Bells',
    bpm: 138,
    timeSignature: '4/4',
    tracks: [
      track('Violin', 'violin', melody, 0.85),
      track('Acoustic guitar', 'acoustic-guitar', guitar, 0.5),
      track('Bass guitar', 'bass-guitar', bass, 0.7),
      track('Drums', 'drums', rockBeat({ bars: 16, crashBars: [0, 8], fillBars: [7] }), 0.45),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Greensleeves (traditional English): flute, acoustic guitar arpeggios and cello, in 6/8.
// ---------------------------------------------------------------------------------------------

function greensleeves(): Song {
  const line = `C5:q D5:8 E5:8. F5:16 E5:8 | D5:q B4:8 G4:8. A4:16 B4:8 |`;
  const refrain = `G5:q. G5:8. F#5:16 E5:8 | D5:q B4:8 G4:8. A4:16 B4:8 |`;
  const cadence = `C5:8. B4:16 A4:8 G#4:8. F#4:16 G#4:8 |`;
  const melody = parseMelody(`r:h r:8 A4:8 |
    ${line} C5:q A4:8 A4:8. G#4:16 A4:8 | B4:q G#4:8 E4:q A4:8 |
    ${line} ${cadence} A4:h r:q |
    ${refrain} C5:q A4:8 A4:8. G#4:16 A4:8 | B4:q G#4:8 E4:q. |
    ${refrain} ${cadence} A4:h.`);
  const chart = chordChart('- | Am | G | Am | E | Am | G | Am E | Am | C | G | Am | E | C | G | Am E | Am', '6/8');

  // Acoustic guitar: broken chords in eighth notes (bass, then up and back down the shape).
  const guitar = each(chart, (s, { start, beats }, last) => {
    if (last) return chordRows(s.guitar, start, 'w');
    const order = beats === 3 ? [0, 2, 3, 4, 3, 2] : [0, 2, 3];
    return order.map((idx, k) => [s.guitar[idx]!, start + k * 0.5, '8'] as Row);
  });
  // Cello: the root on each dotted-quarter beat, the fifth on the second beat of a full bar.
  const cello = each(chart, (s, { start, beats }, last) => {
    if (last) return [[s.root, start, 'w']];
    if (beats === 1.5) return [[s.root, start, 'h']];
    return [[s.root, start, 'h'] as Row, [transpose(s.root, 7), start + 1.5, 'h'] as Row];
  });

  return {
    title: 'Greensleeves',
    bpm: 90,
    timeSignature: '6/8',
    tracks: [
      track('Flute', 'flute', melody, 0.85),
      track('Acoustic guitar', 'acoustic-guitar', guitar, 0.6),
      track('Cello', 'cello', cello, 0.5),
    ],
  };
}

// ---------------------------------------------------------------------------------------------

export interface ExampleSong {
  id: string;
  title: string;
  credit: string;
  build: () => Song;
}

export const EXAMPLES: ExampleSong[] = [
  { id: 'ode', title: 'Ode to Joy', credit: 'Ludwig van Beethoven', build: odeToJoy },
  { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', credit: 'Traditional', build: twinkleTwinkle },
  { id: 'saints', title: 'When the Saints Go Marching In', credit: 'Traditional', build: whenTheSaints },
  { id: 'amazing-grace', title: 'Amazing Grace', credit: 'Traditional hymn', build: amazingGrace },
  { id: 'jingle-bells', title: 'Jingle Bells', credit: 'James Lord Pierpont', build: jingleBells },
  { id: 'greensleeves', title: 'Greensleeves', credit: 'Traditional English', build: greensleeves },
];

export function findExample(id: unknown): ExampleSong | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

/** A fresh copy of an example song (new note and track ids every time); Ode to Joy by default. */
export function exampleSong(id = 'ode'): Song {
  return (findExample(id) ?? EXAMPLES[0]!).build();
}

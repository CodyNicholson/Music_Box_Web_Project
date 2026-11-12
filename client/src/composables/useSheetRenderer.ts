import { shallowRef, type Ref } from 'vue';
import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow/bravura';
import type { NoteEvent, Song, Track } from '@/types/music';
import { layoutStaffMeasures, measureCountFor, type StaffEvent } from '@/utils/measures';
import { drumSound, instrument, type StaffClef, type StaffDef } from '@/utils/instruments';
import { pitchToMidi } from '@/utils/music';

export interface TimelinePoint {
  beat: number;
  x: number;
}

/** Vertical strip of the score that belongs to one track, in SVG pixels. */
export interface TrackBand {
  trackId: string;
  top: number;
  bottom: number;
}

export interface SheetLayout {
  width: number;
  height: number;
  /** Beat -> x pixel anchors (one per note/rest start), sorted by beat. */
  timeline: TimelinePoint[];
  /** Note id -> the SVG groups that draw it. */
  noteElements: Map<string, SVGElement[]>;
  trackBands: TrackBand[];
}

const TOP = 20;
const LABEL_WIDTH = 96; // instrument names left of the staves
const LEFT = 10 + LABEL_WIDTH;
const RIGHT = 10;
const STAFF_STEP = 110; // between the staves of one instrument (e.g. piano treble -> bass)
const TRACK_STEP = 125; // between instruments
const BOTTOM_ROOM = 120;
const FIRST_MEASURE_EXTRA = 80; // room for clefs + time signature
const MIN_MEASURE_WIDTH = 170;
const WIDTH_PER_EVENT = 34;
const MIN_MEASURES = 4;
// A Stave drawn at y has its top line at y + 40 and its bottom line at y + 80.
const LINES_TOP = 40;
const LINES_BOTTOM = 80;

/** One staff line of the score: a track's staff plus its notes, laid out bar by bar. */
interface StaffRow {
  track: Track;
  def: StaffDef;
  y: number;
  measures: StaffEvent[][];
  /** Staff position -> notehead type (drum-kit cymbals use x noteheads). */
  heads: Map<string, string>;
}

/** Octave shift that keeps flat/sharp spelling: "Bb3" -> "Bb4". */
function shiftOctave(pitch: string, octaves: number): string {
  return pitch.replace(/\d$/, (d) => String(Number(d) + octaves));
}

/** The notes a staff draws, moved to where they are written (drum staff positions, guitar octave). */
function staffNotes(track: Track, def: StaffDef): { notes: NoteEvent[]; heads: Map<string, string> } {
  const heads = new Map<string, string>();
  if (def.clef === 'percussion') {
    const notes = track.notes.map((n) => {
      const sound = drumSound(n.pitch);
      const staffPitch = sound?.staffPitch ?? 'C5';
      if (sound?.head) heads.set(staffPitch, sound.head);
      return { ...n, pitch: staffPitch };
    });
    return { notes, heads };
  }
  const notes = track.notes
    .filter((n) => !def.accepts || def.accepts(pitchToMidi(n.pitch)))
    .map((n) => (def.octaveDown ? { ...n, pitch: shiftOctave(n.pitch, 1) } : n));
  return { notes, heads };
}

function toVexKey(pitch: string): string {
  const m = /^([A-G])(#|b)?(\d)$/.exec(pitch)!;
  return `${m[1]!.toLowerCase()}${m[2] ?? ''}/${m[3]}`;
}

function buildNote(event: StaffEvent, clef: StaffClef, heads: Map<string, string>): StaveNote {
  const isRest = event.kind === 'rest';
  const note = new StaveNote({
    clef,
    keys: isRest
      ? [clef === 'bass' ? 'd/3' : 'b/4']
      : event.pitches.map((p) => (heads.has(p) ? `${toVexKey(p)}/${heads.get(p)}` : toVexKey(p))),
    duration: `${event.vfDuration}${'d'.repeat(event.dots)}${isRest ? 'r' : ''}`,
    auto_stem: !isRest,
  });
  if (!isRest) {
    event.pitches.forEach((pitch, i) => {
      const accidental = /^[A-G](#|b)/.exec(pitch)?.[1];
      if (accidental) note.addModifier(new Accidental(accidental), i);
    });
  }
  if (event.dots > 0) Dot.buildAndAttach([note], { all: true });
  return note;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Transparent box behind a note so clicks between chord noteheads still select it. */
function addHitArea(group: SVGElement) {
  const box = (group as SVGGraphicsElement).getBBox();
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('class', 'hit');
  rect.setAttribute('x', String(box.x - 3));
  rect.setAttribute('y', String(box.y - 3));
  rect.setAttribute('width', String(box.width + 6));
  rect.setAttribute('height', String(box.height + 6));
  rect.setAttribute('fill', 'transparent');
  rect.setAttribute('stroke', 'none');
  group.insertBefore(rect, group.firstChild);
}

function noteCenterX(note: StaveNote): number {
  return (note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2;
}

const LABEL_CHARS = 10; // what fits in LABEL_WIDTH at 13px bold

/** Splits a track name into at most two lines that fit left of the staves ("Acoustic" / "guitar"). */
export function labelLines(name: string, max = LABEL_CHARS): string[] {
  const cut = (text: string) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const words = name.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines.map(cut);
  return [cut(lines[0]!), cut(lines.slice(1).join(' '))];
}

export function useSheetRenderer(container: Ref<HTMLElement | null>) {
  const layout = shallowRef<SheetLayout | null>(null);

  function render(song: Song) {
    const el = container.value;
    if (!el) return;
    el.innerHTML = '';

    // Every staff spans the same bars, so the score is as long as the longest track.
    const measureCount = measureCountFor(
      song.tracks.flatMap((t) => t.notes),
      song.timeSignature,
      MIN_MEASURES,
    );
    const [numBeats, beatValue] = song.timeSignature.split('/').map(Number) as [number, number];
    const beamGroups = Beam.getDefaultBeamGroups(song.timeSignature);

    const rows: StaffRow[] = [];
    const trackBands: TrackBand[] = [];
    let y = TOP;
    song.tracks.forEach((track, ti) => {
      if (ti > 0) y += TRACK_STEP - STAFF_STEP;
      const top = y;
      instrument(track.instrument).staves.forEach((def, si) => {
        if (si > 0) y += STAFF_STEP;
        const { notes, heads } = staffNotes(track, def);
        rows.push({ track, def, y, heads, measures: layoutStaffMeasures(notes, song.timeSignature, measureCount) });
      });
      trackBands.push({ trackId: track.id, top: top + 10, bottom: y + LINES_BOTTOM + 30 });
      y += STAFF_STEP;
    });
    const height = rows.length ? rows[rows.length - 1]!.y + BOTTOM_ROOM : TOP + BOTTOM_ROOM;

    const widths = Array.from({ length: measureCount }, (_, i) => {
      const events = Math.max(...rows.map((r) => r.measures[i]!.length), 1);
      return Math.max(MIN_MEASURE_WIDTH, 50 + events * WIDTH_PER_EVENT) + (i === 0 ? FIRST_MEASURE_EXTRA : 0);
    });
    const totalWidth = LEFT + RIGHT + widths.reduce((a, b) => a + b, 0);

    const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(totalWidth, height);
    const ctx = renderer.getContext();

    // Instrument names, vertically centred on each track's staves.
    ctx.save();
    ctx.setFont('Arial', 13, 'bold');
    ctx.setFillStyle('#3b3f4a');
    song.tracks.forEach((track) => {
      const own = rows.filter((r) => r.track === track);
      if (!own.length) return;
      const mid = (own[0]!.y + LINES_TOP + own[own.length - 1]!.y + LINES_BOTTOM) / 2;
      const lines = labelLines(track.name);
      lines.forEach((line, li) => ctx.fillText(line, 10, mid + 4 + (li - (lines.length - 1) / 2) * 16));
    });
    ctx.restore();

    const points = new Map<number, number>();
    const noteElements = new Map<string, SVGElement[]>();
    let x = LEFT;
    let lastStaveEnd = x;
    const last = measureCount - 1;

    for (let i = 0; i < measureCount; i++) {
      const width = widths[i]!;
      const staves = rows.map((row) => {
        const stave = new Stave(x, row.y, width);
        if (i === 0) {
          stave.addClef(row.def.clef, 'default', row.def.octaveDown ? '8vb' : undefined).addTimeSignature(song.timeSignature);
        }
        if (i === last) stave.setEndBarType(BarlineType.END);
        return stave;
      });
      // Align every staff's first notes even though the clefs differ in width.
      const noteStart = Math.max(...staves.map((s) => s.getNoteStartX()));
      staves.forEach((s) => s.setNoteStartX(noteStart).setContext(ctx).draw());

      if (i === 0 && staves.length > 1) {
        new StaveConnector(staves[0]!, staves[staves.length - 1]!).setType('singleLeft').setContext(ctx).draw();
      }
      // Instruments with several staves (piano) get a brace and barlines through all of them.
      song.tracks.forEach((track) => {
        const own = staves.filter((_, ri) => rows[ri]!.track === track);
        if (own.length < 2) return;
        const [first, lastOwn] = [own[0]!, own[own.length - 1]!];
        if (i === 0) new StaveConnector(first, lastOwn).setType('brace').setContext(ctx).draw();
        new StaveConnector(first, lastOwn)
          .setType(i === last ? 'boldDoubleRight' : 'singleRight')
          .setContext(ctx)
          .draw();
      });

      const voices = rows.map((row, ri) => {
        const events = row.measures[i]!;
        const notes = events.map((e) => buildNote(e, row.def.clef, row.heads));
        const voice = new Voice({ num_beats: numBeats, beat_value: beatValue }).setMode(Voice.Mode.SOFT);
        voice.addTickables(notes);
        const beams = Beam.generateBeams(notes, { groups: beamGroups });
        return { stave: staves[ri]!, events, notes, voice, beams };
      });

      // Formatting all voices together lines up notes that start on the same beat across instruments.
      const formatter = new Formatter();
      voices.forEach((v) => formatter.joinVoices([v.voice]));
      formatter.format(
        voices.map((v) => v.voice),
        x + width - noteStart - 20,
      );

      for (const v of voices) {
        v.voice.draw(ctx, v.stave);
        v.beams.forEach((b) => b.setContext(ctx).draw());

        v.notes.forEach((note, idx) => {
          const event = v.events[idx]!;
          const cx = noteCenterX(note);
          points.set(event.startBeat, Math.min(points.get(event.startBeat) ?? Infinity, cx));

          const svg = note.getSVGElement();
          if (!svg || event.kind !== 'note') return;
          svg.classList.add('mb-note');
          addHitArea(svg);
          svg.setAttribute('data-note-ids', event.noteIds.join(' '));
          for (const id of event.noteIds) {
            noteElements.set(id, [...(noteElements.get(id) ?? []), svg]);
          }
        });
      }

      x += width;
      lastStaveEnd = x;
    }

    const endBeat = measureCount * (numBeats * (4 / beatValue));
    points.set(endBeat, lastStaveEnd - 6);

    const timeline = [...points.entries()].map(([beat, px]) => ({ beat, x: px })).sort((a, b) => a.beat - b.beat);
    layout.value = { width: totalWidth, height, timeline, noteElements, trackBands };
  }

  /** Interpolated x position of the playhead for a (fractional) beat. */
  function xAtBeat(beat: number): number {
    const tl = layout.value?.timeline;
    if (!tl || tl.length === 0) return 0;
    if (beat <= tl[0]!.beat) return tl[0]!.x;
    let lo = 0;
    let hi = tl.length - 1;
    if (beat >= tl[hi]!.beat) return tl[hi]!.x;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tl[mid]!.beat <= beat) lo = mid;
      else hi = mid;
    }
    const a = tl[lo]!;
    const b = tl[hi]!;
    return a.x + ((beat - a.beat) / (b.beat - a.beat)) * (b.x - a.x);
  }

  return { layout, render, xAtBeat };
}

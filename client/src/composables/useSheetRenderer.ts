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
import type { Song } from '@/types/music';
import { groupIntoMeasures, type Clef, type StaffEvent } from '@/utils/measures';

export interface TimelinePoint {
  beat: number;
  x: number;
}

export interface SheetLayout {
  width: number;
  height: number;
  /** Beat -> x pixel anchors (one per note/rest start), sorted by beat. */
  timeline: TimelinePoint[];
  /** Note id -> the SVG groups that draw it. */
  noteElements: Map<string, SVGElement[]>;
}

const TREBLE_Y = 20;
const BASS_Y = 130;
const HEIGHT = 250;
const LEFT = 10;
const FIRST_MEASURE_EXTRA = 80; // room for clefs + time signature
const MIN_MEASURE_WIDTH = 170;
const WIDTH_PER_EVENT = 34;
const MIN_MEASURES = 4;

function toVexKey(pitch: string): string {
  const m = /^([A-G])(#|b)?(\d)$/.exec(pitch)!;
  return `${m[1]!.toLowerCase()}${m[2] ?? ''}/${m[3]}`;
}

function buildNote(event: StaffEvent, clef: Clef): StaveNote {
  const isRest = event.kind === 'rest';
  const note = new StaveNote({
    clef,
    keys: isRest ? [clef === 'treble' ? 'b/4' : 'd/3'] : event.pitches.map(toVexKey),
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

export function useSheetRenderer(container: Ref<HTMLElement | null>) {
  const layout = shallowRef<SheetLayout | null>(null);

  function render(song: Song) {
    const el = container.value;
    if (!el) return;
    el.innerHTML = '';

    const measures = groupIntoMeasures(song.notes, song.timeSignature, MIN_MEASURES);
    const [numBeats, beatValue] = song.timeSignature.split('/').map(Number) as [number, number];
    const beamGroups = Beam.getDefaultBeamGroups(song.timeSignature);

    const widths = measures.map((m, i) => {
      const events = Math.max(m.treble.length, m.bass.length);
      return Math.max(MIN_MEASURE_WIDTH, 50 + events * WIDTH_PER_EVENT) + (i === 0 ? FIRST_MEASURE_EXTRA : 0);
    });
    const totalWidth = LEFT * 2 + widths.reduce((a, b) => a + b, 0);

    const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(totalWidth, HEIGHT);
    const ctx = renderer.getContext();

    const points = new Map<number, number>();
    const noteElements = new Map<string, SVGElement[]>();
    let x = LEFT;
    let lastStaveEnd = x;

    measures.forEach((measure, i) => {
      const width = widths[i]!;
      const treble = new Stave(x, TREBLE_Y, width);
      const bass = new Stave(x, BASS_Y, width);
      if (i === 0) {
        treble.addClef('treble').addTimeSignature(song.timeSignature);
        bass.addClef('bass').addTimeSignature(song.timeSignature);
      }
      if (i === measures.length - 1) {
        treble.setEndBarType(BarlineType.END);
        bass.setEndBarType(BarlineType.END);
      }
      // Align both staves' first notes even though the clefs differ in width.
      const noteStart = Math.max(treble.getNoteStartX(), bass.getNoteStartX());
      treble.setNoteStartX(noteStart);
      bass.setNoteStartX(noteStart);
      treble.setContext(ctx).draw();
      bass.setContext(ctx).draw();

      if (i === 0) {
        new StaveConnector(treble, bass).setType('brace').setContext(ctx).draw();
        new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
      }
      new StaveConnector(treble, bass)
        .setType(i === measures.length - 1 ? 'boldDoubleRight' : 'singleRight')
        .setContext(ctx)
        .draw();

      const staves = [
        { stave: treble, clef: 'treble' as const, events: measure.treble },
        { stave: bass, clef: 'bass' as const, events: measure.bass },
      ].map((s) => {
        const notes = s.events.map((e) => buildNote(e, s.clef));
        const voice = new Voice({ num_beats: numBeats, beat_value: beatValue }).setMode(Voice.Mode.SOFT);
        voice.addTickables(notes);
        const beams = Beam.generateBeams(notes, { groups: beamGroups });
        return { ...s, notes, voice, beams };
      });

      const formatter = new Formatter();
      staves.forEach((s) => formatter.joinVoices([s.voice]));
      formatter.format(
        staves.map((s) => s.voice),
        treble.getX() + treble.getWidth() - noteStart - 20,
      );

      for (const s of staves) {
        s.voice.draw(ctx, s.stave);
        s.beams.forEach((b) => b.setContext(ctx).draw());

        s.notes.forEach((note, idx) => {
          const event = s.events[idx]!;
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
      lastStaveEnd = treble.getX() + treble.getWidth();
    });

    const lastMeasure = measures[measures.length - 1]!;
    points.set(lastMeasure.startBeat + lastMeasure.beats, lastStaveEnd - 6);

    const timeline = [...points.entries()].map(([beat, px]) => ({ beat, x: px })).sort((a, b) => a.beat - b.beat);
    layout.value = { width: totalWidth, height: HEIGHT, timeline, noteElements };
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

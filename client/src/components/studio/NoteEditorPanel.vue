<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { NoteDuration } from '@/types/music';
import { useSongStore } from '@/stores/songStore';
import {
  CHORD_TYPES,
  DURATION_BEATS,
  DURATION_OPTIONS,
  chordPitches,
  formatPosition,
  isValidPitch,
  normalizePitch,
  pitchRange,
} from '@/utils/music';
import { quantize } from '@/utils/measures';
import { DRUM_SOUNDS, instrument, pitchLabel } from '@/utils/instruments';

const store = useSongStore();

const track = computed(() => store.activeTrack);
const def = computed(() => instrument(track.value.instrument));
const isDrums = computed(() => def.value.kind === 'drums');
/** Pitches the active instrument can play, highest first; drum tracks list the kit pieces. */
const pitchOptions = computed(() =>
  isDrums.value
    ? DRUM_SOUNDS.map((d) => ({ value: d.pitch, label: d.name }))
    : pitchRange(def.value.range[0], def.value.range[1]).reverse().map((p) => ({ value: p, label: p })),
);

const draft = reactive({ pitch: 'C4', startTime: 0, duration: 'q' as NoteDuration, velocity: 0.8 });
const stepInput = ref(true);
/** Chord type to add, or '' for a single note. Only applies when adding, not when editing a note. */
const chordType = ref('');
const error = ref<string | null>(null);

const selected = computed(() => store.selectedNote);
const addingChord = computed(() => !selected.value && !isDrums.value && chordType.value !== '');
const chordPreview = computed(() =>
  addingChord.value && isValidPitch(draft.pitch) ? chordPitches(draft.pitch, chordType.value) : [],
);
const durationLabel = (d: NoteDuration) => DURATION_OPTIONS.find((o) => o.value === d)?.label ?? d;

// Switching to another instrument: keep the pitch if it can play it, otherwise use its default.
watch(
  () => track.value.instrument,
  () => {
    if (!pitchOptions.value.some((o) => o.value === draft.pitch)) draft.pitch = def.value.defaultPitch;
  },
  { immediate: true },
);

// Selecting a note (here or on the score) loads it into the form.
watch(selected, (note) => {
  if (!note) return;
  Object.assign(draft, {
    pitch: note.pitch,
    startTime: note.startTime,
    duration: note.duration,
    velocity: note.velocity ?? 0.8,
  });
});

function validDraft() {
  const startTime = Number(draft.startTime);
  if (!isValidPitch(draft.pitch)) error.value = isDrums.value ? 'Pick a drum.' : 'Pick a pitch such as C4 or F#5.';
  else if (!Number.isFinite(startTime) || startTime < 0) error.value = 'Start beat must be 0 or more.';
  else {
    error.value = null;
    return { pitch: draft.pitch, startTime: quantize(startTime), duration: draft.duration, velocity: draft.velocity };
  }
  return null;
}

function addNote() {
  const note = validDraft();
  if (!note) return;
  if (addingChord.value) {
    // Every chord note goes on the same beat; skip pitches already sounding there.
    const taken = new Set(
      track.value.notes.filter((n) => n.startTime === note.startTime).map((n) => normalizePitch(n.pitch)),
    );
    const pitches = chordPitches(note.pitch, chordType.value).filter((p) => !taken.has(p));
    if (pitches.length) store.addNotes(pitches.map((pitch) => ({ ...note, pitch })));
  } else {
    store.addNote(note);
  }
  store.selectNote(null);
  draft.startTime = note.startTime + DURATION_BEATS[note.duration];
}

function updateSelected() {
  const note = validDraft();
  if (!note || !selected.value) return;
  store.updateNote(selected.value.id, note);
}

function deselect() {
  store.selectNote(null);
}

/** Called by the studio when a piano key is pressed. */
function handlePianoPress(pitch: string) {
  draft.pitch = pitch;
  if (selected.value) updateSelected();
  else if (stepInput.value) addNote();
}

function clearAll() {
  if (confirm(`Remove every note from "${track.value.name}"?`)) store.clearNotes();
}

defineExpose({ handlePianoPress });
</script>

<template>
  <section class="editor panel">
    <header class="editor-header">
      <h2>
        {{ selected ? 'Edit note' : 'Add notes' }}
        <span class="track-name">· {{ def.icon }} {{ track.name }}</span>
      </h2>
      <label
        class="toggle"
        :title="`When on, each ${isDrums ? 'pad' : 'key'} you press adds a note${isDrums ? '' : ' (or a chord on that root)'} and moves the start beat forward`"
      >
        <input v-model="stepInput" type="checkbox" />
        Step input from {{ isDrums ? 'pads' : 'keyboard' }}
      </label>
    </header>

    <form class="note-form" @submit.prevent="selected ? updateSelected() : addNote()">
      <label v-if="!selected && !isDrums" class="field">
        <span>Chord</span>
        <select v-model="chordType">
          <option value="">Single note</option>
          <option v-for="c in CHORD_TYPES" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
        <small v-if="chordPreview.length" class="muted mono">{{ chordPreview.join(' ') }}</small>
      </label>
      <label class="field">
        <span>{{ isDrums ? 'Drum' : addingChord ? 'Root' : 'Pitch' }}</span>
        <select v-model="draft.pitch">
          <option v-for="p in pitchOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
          <option v-if="!pitchOptions.some((o) => o.value === draft.pitch)" :value="draft.pitch">{{ draft.pitch }}</option>
        </select>
      </label>
      <label class="field">
        <span>Start beat</span>
        <input v-model.number="draft.startTime" type="number" min="0" step="0.25" />
        <small class="muted">bar:beat {{ formatPosition(Number(draft.startTime) || 0, store.song.timeSignature) }}</small>
      </label>
      <label class="field">
        <span>Duration</span>
        <select v-model="draft.duration">
          <option v-for="d in DURATION_OPTIONS" :key="d.value" :value="d.value">{{ d.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>Velocity {{ Math.round(draft.velocity * 100) }}%</span>
        <input v-model.number="draft.velocity" type="range" min="0.1" max="1" step="0.05" />
      </label>
      <div class="form-actions">
        <template v-if="selected">
          <button type="submit" class="btn btn-primary">Update note</button>
          <button type="button" class="btn btn-danger" @click="store.removeNote(selected.id)">Delete</button>
          <button type="button" class="btn" @click="deselect">Done</button>
        </template>
        <button v-else type="submit" class="btn btn-primary">{{ addingChord ? 'Add chord' : 'Add note' }}</button>
      </div>
      <p v-if="error" class="error small">{{ error }}</p>
    </form>

    <div class="list-header">
      <h3>{{ track.name }} notes <span class="muted">({{ track.notes.length }})</span></h3>
      <button v-if="track.notes.length" type="button" class="btn btn-ghost small" @click="clearAll">Clear track</button>
    </div>
    <div class="note-list">
      <p v-if="track.notes.length === 0" class="muted small empty">
        No notes on this staff yet. {{ isDrums ? 'Hit the pads' : 'Press keys' }} with step input on, or use the form above.
      </p>
      <table v-else>
        <thead>
          <tr><th>Bar:beat</th><th>{{ isDrums ? 'Drum' : 'Pitch' }}</th><th>Length</th><th>Vel.</th><th /></tr>
        </thead>
        <tbody>
          <tr
            v-for="note in track.notes"
            :key="note.id"
            :class="{ selected: note.id === store.selectedNoteId, playing: store.activeNoteIds.has(note.id) }"
            @click="store.selectNote(note.id)"
          >
            <td class="mono">{{ formatPosition(note.startTime, store.song.timeSignature) }}</td>
            <td :class="{ mono: !isDrums }">{{ pitchLabel(track.instrument, note.pitch) }}</td>
            <td>{{ durationLabel(note.duration) }}</td>
            <td>{{ Math.round((note.velocity ?? 0.8) * 100) }}</td>
            <td>
              <button
                type="button"
                class="icon-btn"
                :aria-label="`Delete ${pitchLabel(track.instrument, note.pitch)} at ${note.startTime}`"
                @click.stop="store.removeNote(note.id)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.editor-header,
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.track-name {
  font-weight: 500;
  color: var(--muted);
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--muted);
  cursor: pointer;
}
.note-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 12px 0 18px;
}
.form-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
}
.note-form .error {
  grid-column: 1 / -1;
  margin: 0;
}
.note-list {
  overflow-y: auto;
  max-height: 260px;
  margin-top: 6px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  padding: 4px 6px;
  position: sticky;
  top: 0;
  background: var(--surface);
}
td {
  padding: 5px 6px;
  border-top: 1px solid var(--border);
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover {
  background: var(--surface-2);
}
tr.selected {
  background: rgb(110 168 254 / 14%);
}
tr.playing td {
  color: var(--accent);
}
.icon-btn {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.icon-btn:hover {
  color: var(--danger);
}
.empty {
  padding: 8px 0;
}
</style>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { NoteDuration } from '@/types/music';
import { useSongStore } from '@/stores/songStore';
import { DURATION_BEATS, DURATION_OPTIONS, formatPosition, isValidPitch, pitchRange } from '@/utils/music';
import { quantize } from '@/utils/measures';

const store = useSongStore();
const PITCHES = pitchRange('C2', 'C7').reverse();

const draft = reactive({ pitch: 'C4', startTime: 0, duration: 'q' as NoteDuration, velocity: 0.8 });
const stepInput = ref(true);
const error = ref<string | null>(null);

const selected = computed(() => store.selectedNote);
const durationLabel = (d: NoteDuration) => DURATION_OPTIONS.find((o) => o.value === d)?.label ?? d;

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
  if (!isValidPitch(draft.pitch)) error.value = 'Pick a pitch such as C4 or F#5.';
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
  store.addNote(note);
  store.selectedNoteId = null;
  draft.startTime = note.startTime + DURATION_BEATS[note.duration];
}

function updateSelected() {
  const note = validDraft();
  if (!note || !selected.value) return;
  store.updateNote(selected.value.id, note);
}

function deselect() {
  store.selectedNoteId = null;
}

/** Called by the studio when a piano key is pressed. */
function handlePianoPress(pitch: string) {
  draft.pitch = pitch;
  if (selected.value) updateSelected();
  else if (stepInput.value) addNote();
}

function clearAll() {
  if (confirm('Remove every note from this song?')) store.clearNotes();
}

defineExpose({ handlePianoPress });
</script>

<template>
  <section class="editor panel">
    <header class="editor-header">
      <h2>{{ selected ? 'Edit note' : 'Add notes' }}</h2>
      <label class="toggle" title="When on, each piano key you press adds a note and moves the start beat forward">
        <input v-model="stepInput" type="checkbox" />
        Step input from piano
      </label>
    </header>

    <form class="note-form" @submit.prevent="selected ? updateSelected() : addNote()">
      <label class="field">
        <span>Pitch</span>
        <select v-model="draft.pitch">
          <option v-for="p in PITCHES" :key="p" :value="p">{{ p }}</option>
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
        <button v-else type="submit" class="btn btn-primary">Add note</button>
      </div>
      <p v-if="error" class="error small">{{ error }}</p>
    </form>

    <div class="list-header">
      <h3>Notes <span class="muted">({{ store.song.notes.length }})</span></h3>
      <button v-if="store.song.notes.length" type="button" class="btn btn-ghost small" @click="clearAll">Clear all</button>
    </div>
    <div class="note-list">
      <p v-if="store.song.notes.length === 0" class="muted small empty">
        No notes yet. Press piano keys with step input on, or use the form above.
      </p>
      <table v-else>
        <thead>
          <tr><th>Bar:beat</th><th>Pitch</th><th>Length</th><th>Vel.</th><th /></tr>
        </thead>
        <tbody>
          <tr
            v-for="note in store.song.notes"
            :key="note.id"
            :class="{ selected: note.id === store.selectedNoteId, playing: store.activeNoteIds.has(note.id) }"
            @click="store.selectedNoteId = note.id"
          >
            <td class="mono">{{ formatPosition(note.startTime, store.song.timeSignature) }}</td>
            <td class="mono">{{ note.pitch }}</td>
            <td>{{ durationLabel(note.duration) }}</td>
            <td>{{ Math.round((note.velocity ?? 0.8) * 100) }}</td>
            <td>
              <button
                type="button"
                class="icon-btn"
                :aria-label="`Delete ${note.pitch} at ${note.startTime}`"
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

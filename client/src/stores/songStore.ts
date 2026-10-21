import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import type { NoteEvent, Song } from '@/types/music';
import { songsApi } from '@/api/songs.api';
import { generateId, normalizePitch } from '@/utils/music';

export function blankSong(): Song {
  return { title: 'Untitled song', bpm: 120, timeSignature: '4/4', notes: [] };
}

function sortNotes(notes: NoteEvent[]) {
  notes.sort((a, b) => a.startTime - b.startTime || a.pitch.localeCompare(b.pitch));
}

export const useSongStore = defineStore('song', () => {
  const song = ref<Song>(blankSong());
  const dirty = ref(false);
  const saving = ref(false);
  const selectedNoteId = ref<string | null>(null);

  // Ref counts, so overlapping notes of the same pitch don't switch each other off early.
  const pitchCounts = reactive(new Map<string, number>());
  const activeNoteIds = reactive(new Set<string>());
  const activePitches = computed(() => new Set(pitchCounts.keys()));

  const selectedNote = computed(() => song.value.notes.find((n) => n.id === selectedNoteId.value) ?? null);

  function load(next: Song) {
    song.value = { ...next, notes: next.notes.map((n) => ({ ...n, id: n.id ?? generateId() })) };
    sortNotes(song.value.notes);
    selectedNoteId.value = null;
    dirty.value = false;
  }

  function markDirty() {
    dirty.value = true;
  }

  function addNote(note: Omit<NoteEvent, 'id'>): NoteEvent {
    const created = { ...note, id: generateId() };
    song.value.notes.push(created);
    sortNotes(song.value.notes);
    dirty.value = true;
    return created;
  }

  /** Adds several notes in one go, e.g. every note of a chord. */
  function addNotes(notes: Omit<NoteEvent, 'id'>[]): NoteEvent[] {
    const created = notes.map((n) => ({ ...n, id: generateId() }));
    song.value.notes.push(...created);
    sortNotes(song.value.notes);
    dirty.value = true;
    return created;
  }

  function updateNote(id: string, changes: Partial<Omit<NoteEvent, 'id'>>) {
    const note = song.value.notes.find((n) => n.id === id);
    if (!note) return;
    Object.assign(note, changes);
    sortNotes(song.value.notes);
    dirty.value = true;
  }

  function removeNote(id: string) {
    song.value.notes = song.value.notes.filter((n) => n.id !== id);
    if (selectedNoteId.value === id) selectedNoteId.value = null;
    dirty.value = true;
  }

  function clearNotes() {
    song.value.notes = [];
    selectedNoteId.value = null;
    dirty.value = true;
  }

  async function save(): Promise<Song> {
    saving.value = true;
    try {
      const saved = song.value.id
        ? await songsApi.update(song.value.id, song.value)
        : await songsApi.create(song.value);
      // The server assigns fresh note ids; keep the selection if we can match it back.
      const prevSelected = selectedNote.value;
      load(saved);
      if (prevSelected) {
        selectedNoteId.value =
          song.value.notes.find(
            (n) => n.pitch === prevSelected.pitch && n.startTime === prevSelected.startTime,
          )?.id ?? null;
      }
      return saved;
    } finally {
      saving.value = false;
    }
  }

  function noteOn(pitch: string, id?: string) {
    const key = normalizePitch(pitch);
    pitchCounts.set(key, (pitchCounts.get(key) ?? 0) + 1);
    if (id) activeNoteIds.add(id);
  }

  function noteOff(pitch: string, id?: string) {
    const key = normalizePitch(pitch);
    const count = (pitchCounts.get(key) ?? 0) - 1;
    if (count > 0) pitchCounts.set(key, count);
    else pitchCounts.delete(key);
    if (id) activeNoteIds.delete(id);
  }

  function clearActive() {
    pitchCounts.clear();
    activeNoteIds.clear();
  }

  return {
    song,
    dirty,
    saving,
    selectedNoteId,
    selectedNote,
    activePitches,
    activeNoteIds,
    load,
    markDirty,
    addNote,
    addNotes,
    updateNote,
    removeNote,
    clearNotes,
    save,
    noteOn,
    noteOff,
    clearActive,
  };
});

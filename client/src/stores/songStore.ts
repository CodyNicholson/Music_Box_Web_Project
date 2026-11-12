import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import type { InstrumentId, NoteEvent, Song, Track } from '@/types/music';
import { songsApi } from '@/api/songs.api';
import { generateId, normalizePitch } from '@/utils/music';
import { defaultTrackName, instrument } from '@/utils/instruments';

export const MAX_TRACKS = 12;

export function newTrack(id: InstrumentId, existing: Pick<Track, 'name'>[] = []): Track {
  return { id: generateId(), name: defaultTrackName(id, existing), instrument: id, volume: 0.8, muted: false, notes: [] };
}

export function blankSong(): Song {
  return { title: 'Untitled song', bpm: 120, timeSignature: '4/4', tracks: [newTrack('piano')] };
}

function sortNotes(notes: NoteEvent[]) {
  notes.sort((a, b) => a.startTime - b.startTime || a.pitch.localeCompare(b.pitch));
}

/** Key for the active-pitch ref counts: the same pitch can sound on two tracks at once. */
const pitchKey = (trackId: string, pitch: string) => `${trackId}|${normalizePitch(pitch)}`;

export const useSongStore = defineStore('song', () => {
  const song = ref<Song>(blankSong());
  const dirty = ref(false);
  const saving = ref(false);
  const selectedNoteId = ref<string | null>(null);
  /** The track that new notes, the keyboard and the editor work on. */
  const activeTrackId = ref<string>(song.value.tracks[0]!.id);

  // Ref counts, so overlapping notes of the same pitch don't switch each other off early.
  const pitchCounts = reactive(new Map<string, number>());
  const activeNoteIds = reactive(new Set<string>());

  const activeTrack = computed<Track>(
    () => song.value.tracks.find((t) => t.id === activeTrackId.value) ?? song.value.tracks[0]!,
  );
  /** Pitches sounding on the active track, which the piano or drum pad lights up. */
  const activePitches = computed(() => {
    const prefix = `${activeTrack.value.id}|`;
    return new Set([...pitchCounts.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
  });
  const noteCount = computed(() => song.value.tracks.reduce((sum, t) => sum + t.notes.length, 0));

  function findNote(id: string | null): { track: Track; note: NoteEvent } | null {
    if (!id) return null;
    for (const track of song.value.tracks) {
      const note = track.notes.find((n) => n.id === id);
      if (note) return { track, note };
    }
    return null;
  }

  const selectedNote = computed(() => findNote(selectedNoteId.value)?.note ?? null);

  function load(next: Song) {
    const tracks = next.tracks.length ? next.tracks : [newTrack('piano')];
    song.value = {
      ...next,
      tracks: tracks.map((t) => ({
        ...t,
        id: t.id ?? generateId(),
        volume: t.volume ?? 0.8,
        muted: t.muted ?? false,
        notes: t.notes.map((n) => ({ ...n, id: n.id ?? generateId() })),
      })),
    };
    song.value.tracks.forEach((t) => sortNotes(t.notes));
    activeTrackId.value = song.value.tracks[0]!.id;
    selectedNoteId.value = null;
    dirty.value = false;
  }

  function markDirty() {
    dirty.value = true;
  }

  /** Selects a note (or clears the selection) and makes its track the active one. */
  function selectNote(id: string | null) {
    selectedNoteId.value = id;
    const found = findNote(id);
    if (found) activeTrackId.value = found.track.id;
  }

  function setActiveTrack(id: string) {
    if (id === activeTrackId.value) return;
    activeTrackId.value = id;
    if (findNote(selectedNoteId.value)?.track.id !== id) selectedNoteId.value = null;
  }

  function addTrack(id: InstrumentId): Track | null {
    if (song.value.tracks.length >= MAX_TRACKS) return null;
    const track = newTrack(id, song.value.tracks);
    song.value.tracks.push(track);
    setActiveTrack(track.id);
    dirty.value = true;
    return track;
  }

  function removeTrack(id: string) {
    if (song.value.tracks.length <= 1) return;
    const index = song.value.tracks.findIndex((t) => t.id === id);
    if (index < 0) return;
    if (findNote(selectedNoteId.value)?.track.id === id) selectedNoteId.value = null;
    song.value.tracks.splice(index, 1);
    if (activeTrackId.value === id) activeTrackId.value = song.value.tracks[Math.max(0, index - 1)]!.id;
    dirty.value = true;
  }

  function moveTrack(id: string, offset: -1 | 1) {
    const tracks = song.value.tracks;
    const from = tracks.findIndex((t) => t.id === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= tracks.length) return;
    [tracks[from], tracks[to]] = [tracks[to]!, tracks[from]!];
    dirty.value = true;
  }

  /**
   * Changes a track's settings. Switching between a pitched instrument and drums only works on an
   * empty track, because drum notes and melody notes mean different things.
   */
  function updateTrack(id: string, changes: Partial<Pick<Track, 'name' | 'instrument' | 'volume' | 'muted'>>) {
    const track = song.value.tracks.find((t) => t.id === id);
    if (!track) return;
    if (
      changes.instrument &&
      track.notes.length > 0 &&
      instrument(changes.instrument).kind !== instrument(track.instrument).kind
    ) {
      return;
    }
    Object.assign(track, changes);
    dirty.value = true;
  }

  function addNote(note: Omit<NoteEvent, 'id'>): NoteEvent {
    return addNotes([note])[0]!;
  }

  /** Adds notes to the active track, e.g. every note of a chord. */
  function addNotes(notes: Omit<NoteEvent, 'id'>[]): NoteEvent[] {
    const created = notes.map((n) => ({ ...n, id: generateId() }));
    activeTrack.value.notes.push(...created);
    sortNotes(activeTrack.value.notes);
    dirty.value = true;
    return created;
  }

  function updateNote(id: string, changes: Partial<Omit<NoteEvent, 'id'>>) {
    const found = findNote(id);
    if (!found) return;
    Object.assign(found.note, changes);
    sortNotes(found.track.notes);
    dirty.value = true;
  }

  function removeNote(id: string) {
    const found = findNote(id);
    if (!found) return;
    found.track.notes = found.track.notes.filter((n) => n.id !== id);
    if (selectedNoteId.value === id) selectedNoteId.value = null;
    dirty.value = true;
  }

  /** Removes every note from the active track. */
  function clearNotes() {
    if (findNote(selectedNoteId.value)?.track.id === activeTrack.value.id) selectedNoteId.value = null;
    activeTrack.value.notes = [];
    dirty.value = true;
  }

  async function save(): Promise<Song> {
    saving.value = true;
    try {
      const saved = song.value.id
        ? await songsApi.update(song.value.id, song.value)
        : await songsApi.create(song.value);
      // The server assigns fresh track and note ids; keep the active track and selection by position.
      const activeIndex = song.value.tracks.findIndex((t) => t.id === activeTrackId.value);
      const prev = findNote(selectedNoteId.value);
      const prevTrackIndex = prev ? song.value.tracks.indexOf(prev.track) : -1;
      load(saved);
      const active = song.value.tracks[activeIndex];
      if (active) activeTrackId.value = active.id;
      if (prev) {
        selectedNoteId.value =
          song.value.tracks[prevTrackIndex]?.notes.find(
            (n) => n.pitch === prev.note.pitch && n.startTime === prev.note.startTime,
          )?.id ?? null;
      }
      return saved;
    } finally {
      saving.value = false;
    }
  }

  function noteOn(trackId: string, pitch: string, id?: string) {
    const key = pitchKey(trackId, pitch);
    pitchCounts.set(key, (pitchCounts.get(key) ?? 0) + 1);
    if (id) activeNoteIds.add(id);
  }

  function noteOff(trackId: string, pitch: string, id?: string) {
    const key = pitchKey(trackId, pitch);
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
    activeTrackId,
    activeTrack,
    activePitches,
    activeNoteIds,
    noteCount,
    load,
    markDirty,
    selectNote,
    setActiveTrack,
    addTrack,
    removeTrack,
    moveTrack,
    updateTrack,
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

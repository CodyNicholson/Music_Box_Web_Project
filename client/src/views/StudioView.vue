<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { useSongStore, blankSong } from '@/stores/songStore';
import { useAudioEngine } from '@/composables/useAudioEngine';
import { songsApi } from '@/api/songs.api';
import { ApiError } from '@/api/http';
import { findExample } from '@/utils/examples';
import TransportBar from '@/components/studio/TransportBar.vue';
import SheetMusicStage from '@/components/studio/SheetMusicStage.vue';
import NoteEditorPanel from '@/components/studio/NoteEditorPanel.vue';
import VirtualPiano from '@/components/studio/VirtualPiano.vue';
import DrumPad from '@/components/studio/DrumPad.vue';
import InstrumentTracks from '@/components/studio/InstrumentTracks.vue';
import { instrument } from '@/utils/instruments';

const route = useRoute();
const router = useRouter();
const store = useSongStore();
const audio = useAudioEngine();
const activeInstrument = computed(() => instrument(store.activeTrack.instrument));

const loading = ref(false);
const loadError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const editor = ref<InstanceType<typeof NoteEditorPanel> | null>(null);
const transport = ref<InstanceType<typeof TransportBar> | null>(null);

async function loadFromRoute() {
  audio.stop();
  loadError.value = null;
  saveError.value = null;
  const id = typeof route.params.id === 'string' ? route.params.id : undefined;

  if (!id) {
    const example = findExample(route.query.example);
    store.load(example ? example.build() : blankSong());
    if (example) store.markDirty();
    return;
  }
  if (store.song.id === id) return; // just saved a new song and moved to its URL

  loading.value = true;
  try {
    store.load(await songsApi.get(id));
  } catch (err) {
    loadError.value = err instanceof ApiError && err.status === 404 ? 'That song was not found.' : 'Could not load the song.';
  } finally {
    loading.value = false;
  }
}

async function save() {
  saveError.value = null;
  try {
    const saved = await store.save();
    if (route.params.id !== saved.id) await router.replace({ name: 'studio', params: { id: saved.id } });
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Save failed';
  }
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName);
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  } else if (e.code === 'Space' && !isTyping(e.target)) {
    e.preventDefault();
    transport.value?.togglePlay();
  } else if (e.key === 'Escape') {
    store.selectNote(null);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedNoteId && !isTyping(e.target)) {
    store.removeNote(store.selectedNoteId);
  }
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (store.dirty) e.preventDefault();
}

// Start downloading each instrument's samples as soon as it appears in the song.
watch(
  () => store.song.tracks.map((t) => t.instrument),
  (ids) => audio.preload(ids),
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('beforeunload', onBeforeUnload);
});
onBeforeUnmount(() => {
  audio.stop();
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('beforeunload', onBeforeUnload);
});

onBeforeRouteLeave((to) => {
  // Moving from /studio to /studio/:id after the first save is not leaving.
  if (to.name === 'studio' && to.params.id === store.song.id) return true;
  if (store.dirty && !confirm('You have unsaved changes. Leave anyway?')) return false;
  audio.stop();
  return true;
});

watch(() => [route.params.id, route.query.example], loadFromRoute, { immediate: true });
</script>

<template>
  <div class="studio">
    <p v-if="loading" class="muted">Loading song…</p>
    <div v-else-if="loadError" class="panel">
      <p class="error">{{ loadError }}</p>
      <RouterLink to="/library" class="btn">Back to library</RouterLink>
    </div>
    <template v-else>
      <TransportBar ref="transport" :save-error="saveError" @save="save" />
      <InstrumentTracks />
      <SheetMusicStage />
      <div class="lower">
        <DrumPad
          v-if="activeInstrument.kind === 'drums'"
          class="piano-area"
          :highlight-pitch="store.selectedNote?.pitch ?? null"
          @press="editor?.handlePianoPress($event)"
        />
        <VirtualPiano
          v-else
          class="piano-area"
          :low="activeInstrument.keyboard[0]"
          :high="activeInstrument.keyboard[1]"
          :title="`${activeInstrument.icon} ${store.activeTrack.name}`"
          :highlight-pitch="store.selectedNote?.pitch ?? null"
          @press="editor?.handlePianoPress($event)"
        />
        <NoteEditorPanel ref="editor" class="editor-area" />
      </div>
      <p class="muted small shortcuts">
        <kbd>Space</kbd> play/pause · <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Esc</kbd> deselect ·
        <kbd>Del</kbd> delete selected note
      </p>
    </template>
  </div>
</template>

<style scoped>
.studio {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
.lower {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 960px) {
  .lower {
    grid-template-columns: minmax(0, 1fr);
  }
}
.shortcuts {
  margin: 0;
}
</style>

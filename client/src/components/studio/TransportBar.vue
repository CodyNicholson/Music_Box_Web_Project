<script setup lang="ts">
import { computed } from 'vue';
import { useSongStore } from '@/stores/songStore';
import { useAudioEngine } from '@/composables/useAudioEngine';
import { useSongExport } from '@/composables/useSongExport';
import { audibleTracks } from '@/audio/renderSong';
import { instrument } from '@/utils/instruments';
import { TIME_SIGNATURES, formatPosition } from '@/utils/music';

defineProps<{ saveError?: string | null }>();
const emit = defineEmits<{ save: [] }>();

const store = useSongStore();
const audio = useAudioEngine();
const loadingLabel = computed(() => audio.loading.value.map((id) => instrument(id).label.toLowerCase()).join(', '));

const exporter = useSongExport();
const exportingHere = computed(() => exporter.exportingKey.value === 'studio');
const exportError = computed(() => (exporter.errorKey.value === 'studio' ? exporter.error.value : null));
const canExport = computed(() => audibleTracks(store.song).length > 0);

const isPlaying = computed(() => audio.state.value === 'playing');
const position = computed(() => formatPosition(Math.floor(audio.currentBeat.value), store.song.timeSignature));

function togglePlay() {
  if (isPlaying.value) audio.pause();
  else audio.play(store.song);
}

function onBpm(e: Event) {
  const bpm = Math.round(Number((e.target as HTMLInputElement).value));
  if (!Number.isFinite(bpm)) return;
  store.song.bpm = Math.min(300, Math.max(20, bpm));
  store.markDirty();
  audio.setBpm(store.song.bpm);
}

defineExpose({ togglePlay });
</script>

<template>
  <div class="transport panel">
    <input
      v-model="store.song.title"
      class="title-input"
      maxlength="120"
      aria-label="Song title"
      @input="store.markDirty()"
    />

    <div class="controls">
      <button
        type="button"
        class="btn btn-primary round"
        :disabled="store.noteCount === 0"
        :title="isPlaying ? 'Pause (Space)' : 'Play (Space)'"
        @click="togglePlay"
      >
        <svg v-if="isPlaying" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        <span class="sr-only">{{ isPlaying ? 'Pause' : 'Play' }}</span>
      </button>
      <button
        type="button"
        class="btn round"
        :disabled="audio.state.value === 'stopped'"
        title="Stop"
        @click="audio.stop()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z" /></svg>
        <span class="sr-only">Stop</span>
      </button>
      <output class="position" aria-label="Position (bar:beat)">{{ position }}</output>
    </div>

    <label class="field inline">
      <span>BPM</span>
      <input type="number" min="20" max="300" :value="store.song.bpm" @change="onBpm" />
    </label>
    <label class="field inline">
      <span>Time</span>
      <select v-model="store.song.timeSignature" @change="store.markDirty()">
        <option v-for="ts in TIME_SIGNATURES" :key="ts" :value="ts">{{ ts }}</option>
      </select>
    </label>

    <div class="save-area">
      <span v-if="loadingLabel" class="muted small">Loading {{ loadingLabel }}…</span>
      <span v-if="exportError" class="error small" role="alert">{{ exportError }}</span>
      <span v-if="saveError" class="error small">{{ saveError }}</span>
      <span v-else-if="store.dirty" class="muted small">Unsaved changes</span>
      <span v-else-if="store.song.id" class="muted small">Saved</span>
      <button
        type="button"
        class="btn export"
        :disabled="!canExport || exporter.busy.value"
        :aria-busy="exportingHere"
        :title="canExport ? 'Download the song as an MP3 (muted tracks are left out)' : 'Add notes to an unmuted track to export'"
        @click="exporter.exportMp3(store.song)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v9.2l3.3-3.3 1.4 1.4L12 17l-5.7-5.7 1.4-1.4 3.3 3.3zM5 18h14v2H5z" /></svg>
        <span aria-live="polite">{{ exportingHere ? exporter.status.value : 'Export MP3' }}</span>
      </button>
      <button type="button" class="btn btn-primary" :disabled="store.saving" title="Save (Ctrl+S)" @click="emit('save')">
        {{ store.saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.transport {
  display: flex;
  align-items: center;
  gap: 14px 20px;
  flex-wrap: wrap;
}
.title-input {
  flex: 1 1 220px;
  min-width: 0;
  font-size: 1.15rem;
  font-weight: 600;
  background: transparent;
  border-color: transparent;
}
.title-input:hover,
.title-input:focus {
  border-color: var(--border);
  background: var(--surface-2);
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.round {
  width: 42px;
  height: 42px;
  padding: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
}
.round svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
}
.position {
  font-variant-numeric: tabular-nums;
  font-family: var(--mono);
  min-width: 4.5ch;
  color: var(--muted);
}
.field.inline input {
  width: 5.5em;
}
.export {
  min-width: 9.5em;
  font-variant-numeric: tabular-nums;
}
.export svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
  flex: none;
}
.save-area {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px 12px;
  margin-left: auto;
}
</style>

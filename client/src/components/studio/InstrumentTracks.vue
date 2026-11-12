<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { InstrumentId, Track } from '@/types/music';
import { MAX_TRACKS, useSongStore } from '@/stores/songStore';
import { INSTRUMENTS, instrument } from '@/utils/instruments';

const store = useSongStore();

const menuOpen = ref(false);
const menu = ref<HTMLElement | null>(null);
const canAdd = computed(() => store.song.tracks.length < MAX_TRACKS);

function add(id: InstrumentId) {
  store.addTrack(id);
  menuOpen.value = false;
}

function remove(track: Track) {
  if (track.notes.length && !confirm(`Remove "${track.name}" and its ${track.notes.length} notes?`)) return;
  store.removeTrack(track.id);
}

function changeInstrument(track: Track, e: Event) {
  const id = (e.target as HTMLSelectElement).value as InstrumentId;
  const wasDefaultName = track.name === instrument(track.instrument).label;
  store.updateTrack(track.id, { instrument: id, ...(wasDefaultName ? { name: instrument(id).label } : {}) });
}

function rename(track: Track, e: Event) {
  const name = (e.target as HTMLInputElement).value.trim();
  if (name) store.updateTrack(track.id, { name: name.slice(0, 40) });
  else (e.target as HTMLInputElement).value = track.name;
}

/** Drum notes and melody notes mean different things, so a track with notes keeps its kind. */
function canSwitch(track: Track, id: InstrumentId) {
  return track.notes.length === 0 || instrument(id).kind === instrument(track.instrument).kind;
}

function onDocPointer(e: PointerEvent) {
  if (menu.value && !menu.value.contains(e.target as Node)) menuOpen.value = false;
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false;
}
watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onDocKey);
  } else {
    document.removeEventListener('pointerdown', onDocPointer);
    document.removeEventListener('keydown', onDocKey);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer);
  document.removeEventListener('keydown', onDocKey);
});
</script>

<template>
  <section class="tracks panel" aria-label="Instruments">
    <header class="tracks-header">
      <h2>Instruments <span class="muted">({{ store.song.tracks.length }})</span></h2>
      <p class="hint">Each instrument gets its own staff. Click one to write its notes; all of them play together.</p>
    </header>

    <ul class="track-list">
      <li
        v-for="(track, i) in store.song.tracks"
        :key="track.id"
        class="track"
        :class="{ active: track.id === store.activeTrack.id, muted: track.muted }"
        @click="store.setActiveTrack(track.id)"
      >
        <span class="icon" aria-hidden="true">{{ instrument(track.instrument).icon }}</span>
        <input
          class="name"
          :value="track.name"
          maxlength="40"
          :aria-label="`Name of track ${i + 1}`"
          @change="rename(track, $event)"
          @focus="store.setActiveTrack(track.id)"
        />
        <select
          class="instrument"
          :value="track.instrument"
          :aria-label="`Instrument for ${track.name}`"
          @change="changeInstrument(track, $event)"
          @focus="store.setActiveTrack(track.id)"
        >
          <option
            v-for="def in INSTRUMENTS"
            :key="def.id"
            :value="def.id"
            :disabled="!canSwitch(track, def.id)"
            :title="canSwitch(track, def.id) ? undefined : 'Clear this track\'s notes to switch between drums and pitched instruments'"
          >
            {{ def.icon }} {{ def.label }}
          </option>
        </select>
        <button
          type="button"
          class="icon-btn"
          :class="{ on: track.muted }"
          :aria-pressed="track.muted"
          :title="track.muted ? 'Unmute' : 'Mute'"
          @click.stop="store.updateTrack(track.id, { muted: !track.muted })"
        >
          <svg v-if="track.muted" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9l5 6M21 9l-5 6" class="stroke" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" class="stroke" />
          </svg>
          <span class="sr-only">{{ track.muted ? 'Unmute' : 'Mute' }} {{ track.name }}</span>
        </button>
        <input
          class="volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="track.volume"
          :aria-label="`Volume of ${track.name}`"
          :title="`Volume ${Math.round(track.volume * 100)}%`"
          @input="store.updateTrack(track.id, { volume: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="count muted small" :title="`${track.notes.length} notes`">{{ track.notes.length }}</span>
        <div class="order">
          <button type="button" class="icon-btn" :disabled="i === 0" title="Move staff up" @click.stop="store.moveTrack(track.id, -1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5" class="stroke" /></svg>
            <span class="sr-only">Move {{ track.name }} up</span>
          </button>
          <button
            type="button"
            class="icon-btn"
            :disabled="i === store.song.tracks.length - 1"
            title="Move staff down"
            @click.stop="store.moveTrack(track.id, 1)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" class="stroke" /></svg>
            <span class="sr-only">Move {{ track.name }} down</span>
          </button>
        </div>
        <button
          type="button"
          class="icon-btn danger"
          :disabled="store.song.tracks.length <= 1"
          title="Remove this instrument"
          @click.stop="remove(track)"
        >
          ×<span class="sr-only">Remove {{ track.name }}</span>
        </button>
      </li>
    </ul>

    <div ref="menu" class="add-wrap">
      <button
        type="button"
        class="add-btn"
        :disabled="!canAdd"
        :title="canAdd ? 'Add another instrument staff' : `Songs can have up to ${MAX_TRACKS} instruments`"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" class="stroke" /></svg>
        Add instrument
      </button>
      <ul v-if="menuOpen" class="menu" role="menu">
        <li v-for="def in INSTRUMENTS" :key="def.id" role="none">
          <button type="button" role="menuitem" @click="add(def.id)">
            <span class="icon" aria-hidden="true">{{ def.icon }}</span>{{ def.label }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.tracks-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.track-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: grid;
  gap: 6px;
}
.track {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-left: 3px solid transparent;
  border-radius: 8px;
  background: var(--surface-2);
  cursor: pointer;
  flex-wrap: wrap;
}
.track.active {
  border-color: var(--accent-2);
  border-left-color: var(--accent-2);
  background: rgb(110 168 254 / 10%);
}
.track.muted .icon,
.track.muted .name {
  opacity: 0.55;
}
.icon {
  font-size: 1.2rem;
  width: 1.6em;
  text-align: center;
}
.name {
  flex: 1 1 140px;
  min-width: 0;
  font-weight: 600;
  background: transparent;
  border-color: transparent;
}
.name:hover,
.name:focus {
  border-color: var(--border);
  background: var(--surface);
}
.instrument {
  flex: 0 1 170px;
  min-width: 0;
}
.volume {
  width: 90px;
}
.count {
  min-width: 2.5ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.order {
  display: flex;
}
.icon-btn {
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 1.15rem;
  line-height: 1;
  display: grid;
  place-items: center;
  border-radius: 4px;
}
.icon-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface);
}
.icon-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.icon-btn.on {
  color: var(--danger);
}
.icon-btn.danger:hover:not(:disabled) {
  color: var(--danger);
}
.icon-btn svg,
.add-btn svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}
svg .stroke {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.add-wrap {
  position: relative;
  display: inline-block;
}
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 8px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: none;
  color: var(--accent-2);
  font: inherit;
  cursor: pointer;
}
.add-btn:hover:not(:disabled) {
  border-color: var(--accent-2);
  background: rgb(110 168 254 / 8%);
}
.add-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.menu {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  min-width: 200px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
}
.menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.menu button:hover,
.menu button:focus-visible {
  background: var(--surface-2);
}
</style>

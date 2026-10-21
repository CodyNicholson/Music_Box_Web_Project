<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useSongStore } from '@/stores/songStore';
import { usePianoAudio } from '@/composables/usePianoAudio';
import { useSheetRenderer } from '@/composables/useSheetRenderer';

const store = useSongStore();
const audio = usePianoAudio();

const scroller = ref<HTMLElement | null>(null);
const canvas = ref<HTMLElement | null>(null);
const renderError = ref<string | null>(null);
const { layout, render, xAtBeat } = useSheetRenderer(canvas);

const playheadX = computed(() => xAtBeat(audio.currentBeat.value));
const showPlayhead = computed(() => audio.state.value !== 'stopped');

let highlighted: SVGElement[] = [];
let selected: SVGElement[] = [];

function applyClasses() {
  const elements = layout.value?.noteElements;
  highlighted.forEach((el) => el.classList.remove('is-active'));
  selected.forEach((el) => el.classList.remove('is-selected'));
  if (!elements) return;
  highlighted = [...store.activeNoteIds].flatMap((id) => elements.get(id) ?? []);
  highlighted.forEach((el) => el.classList.add('is-active'));
  selected = store.selectedNoteId ? (elements.get(store.selectedNoteId) ?? []) : [];
  selected.forEach((el) => el.classList.add('is-selected'));
}

function rerender() {
  try {
    render(store.song);
    renderError.value = null;
  } catch (err) {
    console.error(err);
    renderError.value = 'Could not draw the score for these notes.';
  }
  highlighted = [];
  selected = [];
  applyClasses();
}

onMounted(rerender);
watch(
  () => [store.song.notes, store.song.timeSignature],
  () => nextTick(rerender),
  { deep: true },
);
watch(() => [[...store.activeNoteIds], store.selectedNoteId], applyClasses);

// Keep the playhead in view: once it passes the middle of the viewport, scroll with it.
watch(playheadX, (x) => {
  const el = scroller.value;
  if (!el || !showPlayhead.value) return;
  const target = x - el.clientWidth / 2;
  if (target > el.scrollLeft || x < el.scrollLeft) el.scrollLeft = Math.max(0, target);
});
watch(
  () => audio.state.value,
  (state) => {
    if (state === 'stopped' && scroller.value) scroller.value.scrollTo({ left: 0, behavior: 'smooth' });
  },
);

/** Clicking a note selects it; clicking a chord again cycles through its notes. */
function onClick(e: MouseEvent) {
  const group = (e.target as Element).closest('[data-note-ids]');
  if (!group) return;
  const ids = group.getAttribute('data-note-ids')!.split(' ');
  const current = ids.indexOf(store.selectedNoteId ?? '');
  store.selectedNoteId = ids[(current + 1) % ids.length]!;
}
</script>

<template>
  <section class="sheet panel">
    <header class="sheet-header">
      <h2>Score</h2>
      <p class="hint">Click a note to edit it. Notes from middle C up go on the treble staff.</p>
    </header>
    <div ref="scroller" class="paper">
      <div class="stage" :style="layout ? { width: `${layout.width}px`, height: `${layout.height}px` } : undefined">
        <div ref="canvas" class="canvas" @click="onClick" />
        <div
          v-show="showPlayhead"
          class="playhead"
          :style="{ transform: `translate3d(${playheadX}px, 0, 0)` }"
          aria-hidden="true"
        />
      </div>
    </div>
    <p v-if="renderError" class="error small">{{ renderError }}</p>
  </section>
</template>

<style scoped>
.sheet-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.paper {
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--paper);
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 8%);
}
.stage {
  position: relative;
  min-height: 250px;
}
.canvas :deep(svg) {
  display: block;
}
.canvas :deep(.mb-note) {
  cursor: pointer;
}
.canvas :deep(.mb-note path),
.canvas :deep(.mb-note rect:not(.hit)) {
  transition: fill 80ms, stroke 80ms;
}
.canvas :deep(.mb-note:hover path),
.canvas :deep(.mb-note:hover rect:not(.hit)) {
  fill: #5a6d9a;
  stroke: #5a6d9a;
}
.canvas :deep(.mb-note.is-selected path),
.canvas :deep(.mb-note.is-selected rect:not(.hit)) {
  fill: var(--accent-2);
  stroke: var(--accent-2);
}
.canvas :deep(.mb-note.is-active path),
.canvas :deep(.mb-note.is-active rect:not(.hit)) {
  fill: #e8900c;
  stroke: #e8900c;
}
.playhead {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: -1px;
  width: 2px;
  background: #e8900c;
  box-shadow: 0 0 8px rgb(232 144 12 / 70%);
  pointer-events: none;
  will-change: transform;
}
</style>

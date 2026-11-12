<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useSongStore } from '@/stores/songStore';
import { useAudioEngine } from '@/composables/useAudioEngine';
import { DRUM_SOUNDS } from '@/utils/instruments';

defineProps<{ highlightPitch?: string | null }>();
const emit = defineEmits<{ press: [pitch: string] }>();

const store = useSongStore();
const audio = useAudioEngine();

async function hit(pitch: string) {
  emit('press', pitch);
  await audio.attack(pitch);
  // Drum hits are one-shots; drop the highlight shortly after.
  setTimeout(() => audio.release(pitch), 140);
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  const sound = DRUM_SOUNDS.find((d) => d.key === e.key.toLowerCase());
  if (!sound) return;
  e.preventDefault();
  hit(sound.pitch);
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <section class="drum-panel panel">
    <header class="drum-header">
      <h2>Drum kit</h2>
      <p class="hint">
        Click a pad, or type
        <template v-for="(d, i) in DRUM_SOUNDS" :key="d.pitch"><kbd>{{ d.key.toUpperCase() }}</kbd>{{ i < DRUM_SOUNDS.length - 1 ? ' ' : '' }}</template>
      </p>
    </header>
    <div class="pads" role="group" aria-label="Drum pads">
      <button
        v-for="d in DRUM_SOUNDS"
        :key="d.pitch"
        type="button"
        class="pad"
        :class="{
          active: store.activePitches.has(d.pitch),
          selected: highlightPitch === d.pitch,
          cymbal: d.head === 'x2',
        }"
        @pointerdown="hit(d.pitch)"
      >
        <span class="pad-name">{{ d.name }}</span>
        <span class="shortcut">{{ d.key.toUpperCase() }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.drum-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.pads {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
  user-select: none;
  touch-action: manipulation;
}
.pad {
  height: 76px;
  border: 1px solid #3c4458;
  border-radius: 12px;
  background: radial-gradient(circle at 50% 35%, #3a4152, #232837);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-shadow: inset 0 -4px 0 rgb(0 0 0 / 35%);
  transition: background 60ms, transform 60ms, box-shadow 60ms;
}
.pad.cymbal {
  background: radial-gradient(circle at 50% 35%, #5b5236, #2c2a22);
}
.pad.selected {
  box-shadow: inset 0 -4px 0 var(--accent-2);
}
.pad.active {
  background: radial-gradient(circle at 50% 35%, var(--accent), #e38f12);
  color: #2a1a00;
  transform: translateY(2px);
  box-shadow: 0 0 18px rgb(245 181 74 / 55%);
}
.pad-name {
  font-weight: 600;
  font-size: 0.92rem;
}
.shortcut {
  font-size: 11px;
  opacity: 0.7;
}
</style>

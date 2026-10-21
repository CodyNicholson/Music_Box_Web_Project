<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useSongStore } from '@/stores/songStore';
import { usePianoAudio } from '@/composables/usePianoAudio';
import { pitchRange, pitchToMidi, normalizePitch } from '@/utils/music';

const props = withDefaults(defineProps<{ low?: string; high?: string; highlightPitch?: string | null }>(), {
  low: 'C3',
  high: 'C6',
  highlightPitch: null,
});
const emit = defineEmits<{ press: [pitch: string] }>();

const store = useSongStore();
const audio = usePianoAudio();

// Computer keyboard: two rows mapped to a chromatic octave and a bit, starting at `baseOctave`.
const KEY_OFFSETS: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14,
};
const baseOctave = ref(4);
const minOctave = computed(() => Number(props.low.slice(-1)));
const maxOctave = computed(() => Number(props.high.slice(-1)) - 1);

const keys = computed(() => {
  const pitches = pitchRange(props.low, props.high);
  const whiteCount = pitches.filter((p) => !p.includes('#')).length;
  let whiteIndex = 0;
  return pitches.map((pitch) => {
    const black = pitch.includes('#');
    const left = black ? (whiteIndex / whiteCount) * 100 : undefined;
    if (!black) whiteIndex++;
    return { pitch, black, left, whiteWidth: 100 / whiteCount };
  });
});
const whiteKeys = computed(() => keys.value.filter((k) => !k.black));
const blackKeys = computed(() => keys.value.filter((k) => k.black));

const shortcutLabels = computed(() => {
  const base = pitchToMidi(`C${baseOctave.value}`);
  const labels = new Map<number, string>();
  for (const [key, offset] of Object.entries(KEY_OFFSETS)) labels.set(base + offset, key.toUpperCase());
  return labels;
});
const labelFor = (pitch: string) => shortcutLabels.value.get(pitchToMidi(pitch));

const highlighted = computed(() => (props.highlightPitch ? normalizePitch(props.highlightPitch) : null));

// Pitches currently held by pointer or keyboard, so each press gets exactly one release.
const held = new Map<string, string>();

function press(source: string, pitch: string) {
  if (held.has(source)) return;
  held.set(source, pitch);
  audio.attack(pitch);
  emit('press', pitch);
}

function release(source: string) {
  const pitch = held.get(source);
  if (!pitch) return;
  held.delete(source);
  audio.release(pitch);
}

function onPointerDown(e: PointerEvent, pitch: string) {
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  press(`pointer-${e.pointerId}`, pitch);
}

function onPointerEnter(e: PointerEvent, pitch: string) {
  // Glissando: dragging across keys with the button held plays each key.
  if (e.buttons !== 1) return;
  release(`pointer-${e.pointerId}`);
  press(`pointer-${e.pointerId}`, pitch);
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  const key = e.key.toLowerCase();
  if (key === 'z') baseOctave.value = Math.max(minOctave.value, baseOctave.value - 1);
  else if (key === 'x') baseOctave.value = Math.min(maxOctave.value, baseOctave.value + 1);
  else if (key in KEY_OFFSETS) {
    const midi = pitchToMidi(`C${baseOctave.value}`) + KEY_OFFSETS[key]!;
    const pitch = keys.value.find((k) => pitchToMidi(k.pitch) === midi)?.pitch;
    if (pitch) press(`key-${key}`, pitch);
  } else return;
  e.preventDefault();
}

function onKeyUp(e: KeyboardEvent) {
  release(`key-${e.key.toLowerCase()}`);
}

function releaseAll(prefix = '') {
  for (const source of [...held.keys()]) if (source.startsWith(prefix)) release(source);
}

const releasePointers = () => releaseAll('pointer-');
const releaseEverything = () => releaseAll();

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseEverything);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', releaseEverything);
  releaseEverything();
});
</script>

<template>
  <section class="piano-panel panel">
    <header class="piano-header">
      <h2>Piano</h2>
      <p class="hint">
        Click, or type <kbd>A</kbd>–<kbd>L</kbd> (black keys <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> <kbd>Y</kbd>
        <kbd>U</kbd> <kbd>O</kbd>). <kbd>Z</kbd>/<kbd>X</kbd> shift octave · now C{{ baseOctave }}
      </p>
    </header>
    <div class="piano" role="group" aria-label="Virtual piano" @pointerup="releasePointers" @pointerleave="releasePointers">
      <button
        v-for="key in whiteKeys"
        :key="key.pitch"
        type="button"
        class="key white"
        :class="{ active: store.activePitches.has(key.pitch), selected: highlighted === key.pitch }"
        :aria-label="key.pitch"
        @pointerdown="onPointerDown($event, key.pitch)"
        @pointerenter="onPointerEnter($event, key.pitch)"
      >
        <span v-if="labelFor(key.pitch)" class="shortcut">{{ labelFor(key.pitch) }}</span>
        <span v-if="key.pitch.startsWith('C')" class="name">{{ key.pitch }}</span>
      </button>
      <button
        v-for="key in blackKeys"
        :key="key.pitch"
        type="button"
        class="key black"
        :class="{ active: store.activePitches.has(key.pitch), selected: highlighted === key.pitch }"
        :style="{ left: `calc(${key.left}% - ${key.whiteWidth * 0.3}%)`, width: `${key.whiteWidth * 0.6}%` }"
        :aria-label="key.pitch"
        @pointerdown="onPointerDown($event, key.pitch)"
        @pointerenter="onPointerEnter($event, key.pitch)"
      >
        <span v-if="labelFor(key.pitch)" class="shortcut">{{ labelFor(key.pitch) }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.piano-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.piano {
  position: relative;
  display: flex;
  height: 170px;
  user-select: none;
  touch-action: none;
}
.key {
  border: none;
  padding: 0 0 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  font: inherit;
  transition: background 60ms, transform 60ms, box-shadow 60ms;
}
.white {
  flex: 1;
  background: linear-gradient(#fdfdfb, #ecebe6);
  border-right: 1px solid #b9b7af;
  border-radius: 0 0 6px 6px;
  color: #6b6a64;
  box-shadow: inset 0 -6px 0 #d6d4cc;
}
.white:first-child {
  border-left: 1px solid #b9b7af;
}
.black {
  position: absolute;
  top: 0;
  height: 62%;
  z-index: 1;
  background: linear-gradient(#3a3d46, #15171c);
  border-radius: 0 0 4px 4px;
  color: #c9cbd3;
  box-shadow: inset 0 -5px 0 #000, 0 2px 3px rgb(0 0 0 / 40%);
}
.key.selected {
  box-shadow: inset 0 -6px 0 var(--accent-2);
}
.key.active {
  background: linear-gradient(var(--accent), #e38f12);
  box-shadow: 0 0 18px rgb(245 181 74 / 55%);
  transform: translateY(2px);
  color: #2a1a00;
}
.shortcut {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.75;
}
.name {
  font-size: 10px;
  opacity: 0.6;
}
@media (max-width: 640px) {
  .piano {
    height: 130px;
  }
  .shortcut {
    display: none;
  }
}
</style>

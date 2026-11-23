<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { SongSummary } from '@/types/music';
import { songsApi } from '@/api/songs.api';
import { instrument } from '@/utils/instruments';
import { EXAMPLES, findExample } from '@/utils/examples';
import { useSongExport } from '@/composables/useSongExport';

// Built once to show each sample's tempo, metre and instruments; opening one builds a fresh copy.
const samples = EXAMPLES.map((e) => {
  const song = e.build();
  return {
    id: e.id,
    title: e.title,
    credit: e.credit,
    bpm: song.bpm,
    timeSignature: song.timeSignature,
    instruments: song.tracks.map((t) => t.instrument),
  };
});

const router = useRouter();
const songs = ref<SongSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function load() {
  loading.value = true;
  error.value = null;
  try {
    songs.value = await songsApi.list();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load songs';
  } finally {
    loading.value = false;
  }
}

async function remove(song: SongSummary) {
  if (!confirm(`Delete "${song.title}"? This cannot be undone.`)) return;
  try {
    await songsApi.remove(song.id);
    songs.value = songs.value.filter((s) => s.id !== song.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not delete the song';
  }
}

const exporter = useSongExport();

function exportSong(song: SongSummary) {
  exporter.exportMp3(() => songsApi.get(song.id), song.id);
}

function exportSample(id: string) {
  const example = findExample(id);
  if (example) exporter.exportMp3(example.build(), `sample:${id}`);
}

function showSamples() {
  document.getElementById('samples')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1>Your songs</h1>
        <p class="muted">Open a song to edit and play it, or start a new one.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn" @click="showSamples">Sample songs</button>
        <button type="button" class="btn btn-primary" @click="router.push({ name: 'studio' })">New song</button>
      </div>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <div v-else-if="songs.length === 0 && !error" class="empty panel">
      <h2>No songs yet</h2>
      <p class="muted">Create your first song, or open one of the sample songs below and make it your own.</p>
      <button type="button" class="btn btn-primary" @click="router.push({ name: 'studio' })">Create a song</button>
    </div>

    <ul v-else class="song-grid">
      <li v-for="song in songs" :key="song.id" class="song-card panel">
        <RouterLink :to="{ name: 'studio', params: { id: song.id } }" class="song-link">
          <h2>{{ song.title }}</h2>
          <p class="meta">
            <span>{{ song.bpm }} BPM</span><span>{{ song.timeSignature }}</span
            ><span>{{ song.noteCount }} {{ song.noteCount === 1 ? 'note' : 'notes' }}</span>
          </p>
          <p v-if="song.instruments?.length" class="instruments" :title="song.instruments.map((i) => instrument(i).label).join(', ')">
            <span v-for="(id, i) in song.instruments" :key="i" class="chip">{{ instrument(id).icon }} {{ instrument(id).label }}</span>
          </p>
          <p class="muted small">Updated {{ dateFormat.format(new Date(song.updatedAt)) }}</p>
        </RouterLink>
        <div class="card-actions">
          <button
            type="button"
            class="btn small"
            :disabled="exporter.busy.value || song.noteCount === 0"
            :aria-busy="exporter.exportingKey.value === song.id"
            title="Download as an MP3 (muted tracks are left out)"
            @click="exportSong(song)"
          >
            {{ exporter.exportingKey.value === song.id ? exporter.status.value : 'Download MP3' }}
          </button>
          <span v-if="exporter.errorKey.value === song.id" class="error small" role="alert">{{ exporter.error.value }}</span>
        </div>
        <button type="button" class="btn btn-ghost small delete" @click="remove(song)">Delete</button>
      </li>
    </ul>

    <section id="samples" class="samples" aria-labelledby="samples-title">
      <h2 id="samples-title">Sample songs</h2>
      <p class="muted">Well-known tunes, each arranged for a different band. Open one to play it, edit it and save your own copy.</p>
      <ul class="song-grid">
        <li v-for="sample in samples" :key="sample.id" class="song-card panel">
          <RouterLink :to="{ name: 'studio', query: { example: sample.id } }" class="song-link">
            <h2>{{ sample.title }}</h2>
            <p class="muted small credit">{{ sample.credit }}</p>
            <p class="meta">
              <span>{{ sample.bpm }} BPM</span><span>{{ sample.timeSignature }}</span>
            </p>
            <p class="instruments" :title="sample.instruments.map((i) => instrument(i).label).join(', ')">
              <span v-for="(id, i) in sample.instruments" :key="i" class="chip">{{ instrument(id).icon }} {{ instrument(id).label }}</span>
            </p>
          </RouterLink>
          <div class="card-actions">
            <button
              type="button"
              class="btn small"
              :disabled="exporter.busy.value"
              :aria-busy="exporter.exportingKey.value === `sample:${sample.id}`"
              title="Download as an MP3 (muted tracks are left out)"
              @click="exportSample(sample.id)"
            >
              {{ exporter.exportingKey.value === `sample:${sample.id}` ? exporter.status.value : 'Download MP3' }}
            </button>
            <span v-if="exporter.errorKey.value === `sample:${sample.id}`" class="error small" role="alert">{{ exporter.error.value }}</span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
h1 {
  margin: 0 0 4px;
}
.actions {
  display: flex;
  gap: 10px;
}
.song-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.song-card {
  position: relative;
  padding: 0;
  transition: border-color 120ms, transform 120ms;
}
.song-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.song-link {
  display: block;
  padding: 18px 18px 14px;
  color: inherit;
  text-decoration: none;
}
.song-link h2 {
  margin: 0 0 8px;
  font-size: 1.1rem;
  padding-right: 60px;
  overflow-wrap: anywhere;
}
.meta {
  display: flex;
  gap: 12px;
  margin: 0 0 8px;
  font-size: 0.9rem;
}
.instruments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 8px;
}
.chip {
  font-size: 0.78rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--muted);
}
.song-card {
  display: flex;
  flex-direction: column;
}
.song-link {
  flex: 1;
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 0 18px 16px;
}
.card-actions .btn {
  font-variant-numeric: tabular-nums;
}
.delete {
  position: absolute;
  top: 12px;
  right: 10px;
}
.samples {
  margin-top: 40px;
  scroll-margin-top: 16px;
}
.samples > h2 {
  margin: 0 0 4px;
}
.samples > p {
  margin: 0 0 16px;
}
.samples .song-link h2 {
  padding-right: 0;
}
.credit {
  margin: -4px 0 8px;
}
.empty {
  text-align: center;
  padding: 40px 20px;
}
</style>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { SongSummary } from '@/types/music';
import { songsApi } from '@/api/songs.api';

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
        <button type="button" class="btn" @click="router.push({ name: 'studio', query: { example: 'ode' } })">
          Start from example
        </button>
        <button type="button" class="btn btn-primary" @click="router.push({ name: 'studio' })">New song</button>
      </div>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <div v-else-if="songs.length === 0 && !error" class="empty panel">
      <h2>No songs yet</h2>
      <p class="muted">Create your first song, or open the "Ode to Joy" example and make it your own.</p>
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
          <p class="muted small">Updated {{ dateFormat.format(new Date(song.updatedAt)) }}</p>
        </RouterLink>
        <button type="button" class="btn btn-ghost small delete" @click="remove(song)">Delete</button>
      </li>
    </ul>
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
.delete {
  position: absolute;
  top: 12px;
  right: 10px;
}
.empty {
  text-align: center;
  padding: 40px 20px;
}
</style>

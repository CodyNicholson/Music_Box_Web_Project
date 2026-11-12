import type { Song, SongSummary } from '@/types/music';
import { request } from './http';

function payload(song: Song) {
  return {
    title: song.title,
    bpm: song.bpm,
    timeSignature: song.timeSignature,
    tracks: song.tracks.map((t) => ({
      name: t.name,
      instrument: t.instrument,
      volume: t.volume,
      muted: t.muted,
      notes: t.notes,
    })),
  };
}

export const songsApi = {
  list: () => request<{ songs: SongSummary[] }>('GET', '/api/songs').then((r) => r.songs),
  get: (id: string) => request<{ song: Song }>('GET', `/api/songs/${id}`).then((r) => r.song),
  create: (song: Song) => request<{ song: Song }>('POST', '/api/songs', payload(song)).then((r) => r.song),
  update: (id: string, song: Song) =>
    request<{ song: Song }>('PUT', `/api/songs/${id}`, payload(song)).then((r) => r.song),
  remove: (id: string) => request<void>('DELETE', `/api/songs/${id}`),
};

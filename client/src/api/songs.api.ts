import type { Song, SongSummary } from '@/types/music';
import { request } from './http';

type SongPayload = Pick<Song, 'title' | 'bpm' | 'timeSignature' | 'notes'>;

function payload(song: Song): SongPayload {
  return { title: song.title, bpm: song.bpm, timeSignature: song.timeSignature, notes: song.notes };
}

export const songsApi = {
  list: () => request<{ songs: SongSummary[] }>('GET', '/api/songs').then((r) => r.songs),
  get: (id: string) => request<{ song: Song }>('GET', `/api/songs/${id}`).then((r) => r.song),
  create: (song: Song) => request<{ song: Song }>('POST', '/api/songs', payload(song)).then((r) => r.song),
  update: (id: string, song: Song) =>
    request<{ song: Song }>('PUT', `/api/songs/${id}`, payload(song)).then((r) => r.song),
  remove: (id: string) => request<void>('DELETE', `/api/songs/${id}`),
};

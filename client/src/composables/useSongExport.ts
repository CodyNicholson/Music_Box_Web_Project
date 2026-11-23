import { computed, readonly, ref } from 'vue';
import type { Song } from '@/types/music';
import { MP3_KBPS, mp3FileName } from '@/audio/mp3';
import type { Mp3WorkerMessage, Mp3WorkerRequest } from '@/audio/mp3.worker';

export type ExportPhase = 'idle' | 'loading' | 'rendering' | 'encoding';

// One export at a time across the app: rendering and encoding are heavy, and the button that
// started an export (studio or a library card) shows its progress through `exportingKey`.
const phase = ref<ExportPhase>('idle');
const progress = ref(0);
const exportingKey = ref<string | null>(null);
const error = ref<string | null>(null);
const errorKey = ref<string | null>(null);

function encodeInWorker(channels: Float32Array[], sampleRate: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../audio/mp3.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<Mp3WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') progress.value = msg.fraction;
      else {
        finish();
        if (msg.type === 'done') resolve(msg.mp3);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'The MP3 encoder failed to start.'));
    };
    const request: Mp3WorkerRequest = { channels, sampleRate, kbps: MP3_KBPS };
    worker.postMessage(request, channels.map((ch) => ch.buffer as ArrayBuffer));
  });
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the blob is released.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useSongExport() {
  const busy = computed(() => phase.value !== 'idle');

  /** Human-readable status for the export in progress, e.g. "Encoding 40%". */
  const status = computed(() => {
    switch (phase.value) {
      case 'loading':
        return 'Loading…';
      case 'rendering':
        return 'Rendering…';
      case 'encoding':
        return `Encoding ${Math.round(progress.value * 100)}%`;
      default:
        return '';
    }
  });

  /**
   * Renders `song` (or the song `getSong` resolves, e.g. fetched from the API) to an MP3 and
   * downloads it. `key` identifies the button that started it. Errors land in `error`.
   */
  async function exportMp3(getSong: Song | (() => Promise<Song>), key = 'studio') {
    if (busy.value) return;
    exportingKey.value = key;
    error.value = null;
    errorKey.value = null;
    progress.value = 0;
    try {
      phase.value = 'loading';
      // A plain copy, so edits made while the export runs don't change it halfway (and no Vue proxies).
      const song: Song = typeof getSong === 'function' ? await getSong() : JSON.parse(JSON.stringify(getSong));
      // Loaded on demand, so the library page doesn't pull in the audio engine until it's needed.
      const { renderSong, EXPORT_SAMPLE_RATE } = await import('@/audio/renderSong');
      phase.value = 'rendering';
      const channels = await renderSong(song, EXPORT_SAMPLE_RATE);
      phase.value = 'encoding';
      const mp3 = await encodeInWorker(channels, EXPORT_SAMPLE_RATE);
      download(mp3, mp3FileName(song.title));
    } catch (err) {
      console.error('MP3 export failed', err);
      error.value = err instanceof Error ? err.message : 'The MP3 export failed.';
      errorKey.value = key;
    } finally {
      phase.value = 'idle';
      exportingKey.value = null;
    }
  }

  return {
    busy,
    status,
    phase: readonly(phase),
    exportingKey: readonly(exportingKey),
    error: readonly(error),
    errorKey: readonly(errorKey),
    exportMp3,
  };
}

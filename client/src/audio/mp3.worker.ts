import { encodeMp3 } from './encodeMp3';

/**
 * Encodes off the main thread: a few minutes of audio takes seconds to encode, and the studio
 * should stay responsive (and keep playing) meanwhile.
 */

export interface Mp3WorkerRequest {
  channels: Float32Array[];
  sampleRate: number;
  kbps: number;
}

export type Mp3WorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; mp3: Blob }
  | { type: 'error'; message: string };

// Typed with the DOM lib the rest of the app uses; in a worker, `self` is the worker scope.
const send = (msg: Mp3WorkerMessage) => self.postMessage(msg);

self.onmessage = (e: MessageEvent<Mp3WorkerRequest>) => {
  const { channels, sampleRate, kbps } = e.data;
  try {
    let reported = 0;
    const parts = encodeMp3(channels, sampleRate, kbps, (fraction) => {
      // Throttled to whole percents so the page isn't flooded with messages.
      if (fraction - reported >= 0.01 || fraction === 1) {
        reported = fraction;
        send({ type: 'progress', fraction });
      }
    });
    send({ type: 'done', mp3: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

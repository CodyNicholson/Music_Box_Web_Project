export type NoteDuration = 'w' | 'h' | 'q' | '8' | '16'; // Whole, Half, Quarter, Eighth, Sixteenth

export type TimeSignature = '4/4' | '3/4' | '6/8';

export interface NoteEvent {
  id: string;
  pitch: string; // e.g., "C4", "D#4", "G4"
  startTime: number; // Position in quarter-note beats from the start of the song (e.g., 0, 0.5, 1.25)
  duration: NoteDuration; // Used by VexFlow to draw the notehead/stem and Tone.js for gate time
  velocity?: number; // 0.1 to 1.0
}

export type InstrumentId =
  | 'piano'
  | 'acoustic-guitar'
  | 'electric-guitar'
  | 'bass-guitar'
  | 'violin'
  | 'cello'
  | 'flute'
  | 'drums';

/** One instrument in a song, drawn as its own staff (or grand staff) and played together with the others. */
export interface Track {
  id: string;
  name: string;
  instrument: InstrumentId;
  volume: number; // 0 to 1, multiplied into each note's velocity
  muted: boolean;
  notes: NoteEvent[]; // Sounding pitches; drum notes use General MIDI drum pitches (C2 = kick, D2 = snare, ...)
}

export interface Song {
  id?: string;
  userId?: string;
  title: string;
  bpm: number; // Quarter notes per minute
  timeSignature: TimeSignature;
  tracks: Track[];
}

export interface SongSummary {
  id: string;
  title: string;
  bpm: number;
  timeSignature: TimeSignature;
  noteCount: number;
  instruments: InstrumentId[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
}

/** GET /api/auth/cf-session: the Cloudflare Access (Google OAuth) identity and its Music Box user. */
export interface CfSession {
  authenticated: boolean;
  registered: boolean;
  email?: string;
  user?: User;
}

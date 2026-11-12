import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSongStore } from './songStore';
import { exampleSong } from '@/utils/examples';

describe('song store tracks', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('adds notes to the active track and switches tracks on selection', () => {
    const store = useSongStore();
    const piano = store.activeTrack;
    store.addNote({ pitch: 'C4', startTime: 0, duration: 'q' });
    const violin = store.addTrack('violin')!;
    expect(store.activeTrack.id).toBe(violin.id);
    store.addNotes([{ pitch: 'A4', startTime: 0, duration: 'h' }]);
    expect(piano.notes.map((n) => n.pitch)).toEqual(['C4']);
    expect(store.activeTrack.notes.map((n) => n.pitch)).toEqual(['A4']);
    expect(store.noteCount).toBe(2);

    store.selectNote(piano.notes[0]!.id);
    expect(store.activeTrack.id).toBe(piano.id);
    store.setActiveTrack(violin.id);
    expect(store.selectedNoteId).toBeNull();
  });

  it('keeps at least one track and picks a neighbour when the active one is removed', () => {
    const store = useSongStore();
    const first = store.activeTrack.id;
    store.removeTrack(first);
    expect(store.song.tracks).toHaveLength(1);
    const drums = store.addTrack('drums')!;
    store.removeTrack(drums.id);
    expect(store.activeTrack.id).toBe(first);
  });

  it('only switches between drums and pitched instruments on an empty track', () => {
    const store = useSongStore();
    const t = store.activeTrack;
    store.updateTrack(t.id, { instrument: 'cello' });
    expect(t.instrument).toBe('cello');
    store.addNote({ pitch: 'C3', startTime: 0, duration: 'q' });
    store.updateTrack(t.id, { instrument: 'drums' });
    expect(t.instrument).toBe('cello');
    store.updateTrack(t.id, { instrument: 'violin' });
    expect(t.instrument).toBe('violin');
  });

  it('tracks sounding pitches per track', () => {
    const store = useSongStore();
    store.load(exampleSong());
    const [violin, piano] = store.song.tracks;
    store.noteOn(piano!.id, 'E4');
    expect(store.activePitches.has('E4')).toBe(false); // violin is active
    store.setActiveTrack(piano!.id);
    expect(store.activePitches.has('E4')).toBe(true);
    store.noteOff(piano!.id, 'E4');
    expect(store.activePitches.size).toBe(0);
    expect(violin!.instrument).toBe('violin');
  });

  it('moves tracks up and down', () => {
    const store = useSongStore();
    store.load(exampleSong());
    const drums = store.song.tracks[3]!;
    store.moveTrack(drums.id, -1);
    expect(store.song.tracks.map((t) => t.instrument)).toEqual(['violin', 'piano', 'drums', 'cello']);
    store.moveTrack(store.song.tracks[0]!.id, -1);
    expect(store.song.tracks[0]!.instrument).toBe('violin');
  });
});
